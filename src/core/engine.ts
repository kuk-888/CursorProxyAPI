import crypto from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  Agent,
  AuthenticationError,
  ConfigurationError,
  Cursor,
  CursorSdkError,
  NetworkError,
  RateLimitError,
  type AgentOptions,
  type ModelSelection,
  type Run,
  type SDKAgent,
  type SDKCustomTool,
  type SDKImage,
  type SDKMessage,
  type SDKModel,
  type SDKUserMessage
} from "@cursor/sdk";
import { listLiveModels, resolveModelSelection } from "../services/model-catalog.js";
import type { ExecutionModeTag, UsageTracker } from "../services/usage-tracker.js";
import { AsyncEventQueue, createDeferred } from "../utils/async.js";
import { redactSecrets } from "../utils/hash.js";
import { isQuotaOrBillingExhaustedError, type UpstreamKeyPool } from "./key-pool.js";
import { EphemeralMemoryStore } from "./memory-store.js";
import { findToolArgsProblem, formatToolArgsError, repairToolArgs, MAX_TOOL_ARG_RETRIES } from "./tool-args.js";
import {
  ParkedToolPool,
  WarmAgentPool,
  createLiveExecution,
  type LiveExecution,
  type ToolResultPayload,
  type WarmAgentEntry
} from "./session-pools.js";
import {
  GatewayError,
  type GatewayConfig,
  type GatewayStreamEvent,
  type NormalizedImage,
  type NormalizedTool,
  type NormalizedToolCall,
  type ParsedProtocolTurn,
  type ToolChoiceMode,
  type TurnTokenMetrics
} from "./types.js";

export type AgentFactory = (options: AgentOptions) => Promise<SDKAgent>;

/** Upstream/proxy HTML error pages and sensitive credentials must never be echoed into API error messages. */
function cleanUpstreamMessage(msg: string | undefined, fallback: string): string {
  const m = redactSecrets((msg ?? "").trim());
  if (!m) return fallback;
  if (/<\s*(!doctype|html|body|head)\b/i.test(m)) return fallback;
  return m.length > 600 ? `${m.slice(0, 600)}…` : m;
}

export function mapSdkError(err: unknown): GatewayError {
  if (err instanceof GatewayError) return err;
  if (err instanceof AuthenticationError) {
    // The caller's credential was fine; OUR upstream account is not. Never reflect that as a client 401,
    // which would make SDKs conclude the user's own token is wrong.
    return new GatewayError(
      "Upstream Cursor account rejected the request (authentication). Contact the gateway operator.",
      502,
      "upstream_auth_error"
    );
  }
  if (err instanceof RateLimitError) {
    return new GatewayError(cleanUpstreamMessage(err.message, "Cursor rate limit exceeded."), 429, "rate_limit_error");
  }
  if (err instanceof ConfigurationError) {
    return new GatewayError(cleanUpstreamMessage(err.message, "Invalid model or configuration."), 400, "invalid_request_error");
  }
  if (err instanceof NetworkError) {
    return new GatewayError(cleanUpstreamMessage(err.message, "Upstream Cursor network error."), 502, "bad_gateway");
  }
  if (err instanceof CursorSdkError) {
    return new GatewayError(cleanUpstreamMessage(err.message, "Cursor SDK error."), 502, "upstream_sdk_error");
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new GatewayError(cleanUpstreamMessage(msg, "Unexpected gateway error."), 500, "internal_error");
}

/**
 * tool_choice enforcement hint. Goes into the system section (never appended to the user's own text).
 * It is skipped once the dialog already contains a tool result: forcing "call a tool" again after the
 * tool has answered would trap the model in an endless tool loop.
 */
function buildToolChoiceHint(
  tools: NormalizedTool[],
  toolChoice: ToolChoiceMode,
  hasToolResults: boolean
): string {
  if (!tools.length || hasToolResults || toolChoice === "none" || toolChoice === "auto") return "";
  if (toolChoice === "required") {
    if (tools.length >= 2) {
      const names = tools.map((t) => t.name).join(", ");
      return `You MUST call at least one of the provided tools (${names}) in this reply rather than answering with plain text only.`;
    }
    return "Invoke at least one provided tool in your next reply.";
  }
  if (typeof toolChoice === "object" && toolChoice.type === "tool") {
    return `Invoke the tool "${toolChoice.name}" in your next reply.`;
  }
  return "";
}

function buildVisionGuardHint(turn: ParsedProtocolTurn): string {
  if (turn.images.length === 0 && !(turn.incrementalImages?.length) && !(turn.trailingImages?.length)) return "";
  if (turn.tools.length > 0) return "";
  return "You have no file, shell, or IDE tools. Never emit tool XML, read_file, or function-call markup. Describe only the attached image(s).";
}

function dialogHasToolResults(turn: ParsedProtocolTurn): boolean {
  return turn.hasToolResults === true || turn.trailingToolResults.length > 0;
}

function buildToolResultPayload(text: string, images: NormalizedImage[], isError: boolean): ToolResultPayload {
  const inline = images.filter((im): im is Extract<NormalizedImage, { data: string }> => "data" in im);
  const remote = images.length - inline.length;
  const note = remote > 0 ? `[${remote} remote image URL(s) omitted; only inline base64 images are supported here]` : "";
  const fullText = [text, note].filter(Boolean).join("\n\n");
  if (inline.length === 0 && !isError) return fullText || "[ok]";
  return {
    content: [
      { type: "text" as const, text: fullText || (isError ? "[Error]" : "[ok]") },
      ...inline.map((im) => ({ type: "image" as const, data: im.data, mimeType: im.mimeType }))
    ],
    ...(isError ? { isError: true } : {})
  };
}

function toSdkImages(images: NormalizedImage[]): SDKImage[] {
  return images.map((img) => {
    if ("url" in img) {
      return img.dimension ? { url: img.url, dimension: img.dimension } : { url: img.url };
    }
    return img.dimension
      ? { data: img.data, mimeType: img.mimeType, dimension: img.dimension }
      : { data: img.data, mimeType: img.mimeType };
  });
}

export class CursorExecutionEngine {
  readonly memoryStore = new EphemeralMemoryStore();
  private readonly config: GatewayConfig;
  private readonly usageTracker: UsageTracker;
  private readonly agentFactory: AgentFactory;
  private readonly modelListFetcher?: (apiKey: string) => Promise<SDKModel[]>;
  private readonly parkedPool: ParkedToolPool;
  private readonly warmPool: WarmAgentPool;

  constructor(options: {
    config: GatewayConfig;
    usageTracker: UsageTracker;
    agentFactory?: AgentFactory;
    modelListFetcher?: (apiKey: string) => Promise<SDKModel[]>;
  }) {
    this.config = options.config;
    this.usageTracker = options.usageTracker;
    this.agentFactory = options.agentFactory ?? ((opts) => Agent.create(opts));
    this.modelListFetcher = options.modelListFetcher;

    this.parkedPool = new ParkedToolPool({
      maxItems: this.config.maxParkedRuns,
      ttlMs: this.config.parkedRunTtlMs,
      onDispose: (exec, reason) => this.disposeExecution(exec, reason)
    });

    this.warmPool = new WarmAgentPool({
      maxItems: this.config.maxWarmSessions,
      ttlMs: this.config.warmSessionTtlMs,
      onCloseAgent: (agent) => this.closeAndPurgeAgent(agent)
    });

    this.initSdkSlimming();
  }

  private initSdkSlimming(): void {
    mkdirSync(this.config.emptyWorkspaceDir, { recursive: true, mode: 0o700 });
    process.env.CURSOR_RIPWALK_CACHE_TTL_MS = "86400000";
    Cursor.configure({
      local: {
        store: this.memoryStore.store,
        workspaceScanCacheTtlMs: 86_400_000
      }
    });
  }

  runtimeStats() {
    return {
      parkedToolSessions: this.parkedPool.size,
      warmIdleSessions: this.warmPool.size,
      memoryStore: this.memoryStore.stats()
    };
  }

  async disposeAll(): Promise<void> {
    const parked = this.parkedPool.drainAll();
    await Promise.allSettled([
      this.warmPool.drainAll(),
      ...parked.map((ex) => this.disposeExecution(ex, new Error("Gateway shutting down")))
    ]);
  }

  async resolveModel(apiKey: string, requestedModel: string, body: Record<string, unknown>): Promise<{
    selection: ModelSelection;
    canonicalId: string;
  }> {
    let foundModelSchema: SDKModel | undefined;
    try {
      const catalog = await listLiveModels(apiKey, this.modelListFetcher);
      const baseId = (requestedModel.split("[")[0]?.trim().toLowerCase() || "auto")
        .replace(/-fast$/, "")
        .replace(/-slow$/, "")
        .replace(/-\d+(?:\.\d+)?[km]$/i, "");
      foundModelSchema = catalog.find(
        (m) => m.id.toLowerCase() === baseId || (baseId === "auto" && m.id === "default")
      );
    } catch {
      // Fallback to static parameter mapping if catalog lookup fails
    }
    return resolveModelSelection(requestedModel, body, foundModelSchema);
  }

  /**
   * Unified multi-account aware execution pipeline:
   *  - Tier 1: Resume parked tool run on its exact owning account
   *  - Tier 2: Reuse warm idle Agent on its owning account (if still healthy)
   *  - Tier 3: Lease optimal account from `keyPool` with automatic 429/401 failover
   */
  async *executeTurnWithPool(
    turn: ParsedProtocolTurn,
    keyPool: UpstreamKeyPool,
    onExecMeta?: (meta: { slotId?: string; maskedKey: string; accountLabel?: string; execMode: ExecutionModeTag }) => void
  ): AsyncGenerator<GatewayStreamEvent, void, unknown> {
    // Tier 1: Fast-Path Parked Tool Continuation
    const parked = this.parkedPool.tryClaim(turn.trailingToolResults, turn.requestedModel, turn.scope ?? "");
    if (parked) {
      const lease = keyPool.leaseSpecificKey(parked.apiKey, true);
      onExecMeta?.({
        slotId: lease.slotId,
        maskedKey: lease.maskedKey,
        accountLabel: lease.label,
        execMode: "parked_tool_resume"
      });
      try {
        yield* this.resumeParkedExecution(parked, turn);
        lease.markSuccess();
      } catch (err) {
        // Parked resumes hit the same upstream account: surface 401/429/quota to the pool as well.
        this.classifyAndReportKeyFailure(keyPool, parked.apiKey, turn.requestedModel, mapSdkError(err));
        throw err;
      } finally {
        lease.release();
      }
      return;
    }

    // Tier 2: Warm Session Incremental Continuation (only when no native webSearch tools are added dynamically)
    const activeTools = turn.toolChoice === "none" ? [] : turn.tools;
    const hasNativeSearch = this.config.allowNativeWebTools !== false && (turn.nativeSdkTools?.length ?? 0) > 0;
    // A forced tool_choice needs its hint in the system section, which only a fresh agent can carry.
    const needsToolHint =
      buildToolChoiceHint(activeTools, turn.toolChoice, dialogHasToolResults(turn)) !== ""
      || buildVisionGuardHint(turn) !== "";
    const warm = hasNativeSearch || needsToolHint
      ? null
      : this.warmPool.tryClaim({
          priorPrefixHash: turn.priorPrefixHash,
          incrementalUserText: turn.incrementalUserText,
          hasTrailingToolResults: turn.trailingToolResults.length > 0,
          hasMcpTools: activeTools.length > 0,
          requestedBaseModel: turn.requestedModel,
          scope: turn.scope,
          isKeyUsable: (k) => keyPool.isKeyUsable(k, turn.requestedModel)
        });

    if (warm) {
      const lease = keyPool.leaseSpecificKey(warm.apiKey, true);
      onExecMeta?.({
        slotId: lease.slotId,
        maskedKey: lease.maskedKey,
        accountLabel: lease.label,
        execMode: "warm_incremental"
      });
      let yieldedFromWarm = false;
      try {
        const resolved = await this.resolveModel(warm.apiKey, turn.requestedModel, turn.rawBody);
        for await (const ev of this.runIncrementalOnWarmAgent(warm, turn, resolved)) {
          yieldedFromWarm = true;
          yield ev;
        }
        lease.markSuccess();
        return;
      } catch (err) {
        const gwErr = mapSdkError(err);
        this.classifyAndReportKeyFailure(keyPool, warm.apiKey, turn.requestedModel, gwErr);
        if (yieldedFromWarm) throw gwErr;
        // Fall through seamlessly to Tier 3 stateless fresh run on another healthy key!
      } finally {
        lease.release();
      }
    }

    // Tier 3: Stateless Fresh Run with Sticky Session Affinity, Load Balancing & Auto-Disable Failover
    const triedKeys = new Set<string>();
    // One attempt per enabled key. (+1 made the last loop hit "no_enabled_keys" and mask the real 429/401.)
    const maxAttempts = Math.max(1, keyPool.enabledKeyCount());

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const lease = keyPool.leaseKey(turn.requestedModel, triedKeys, turn.conversationKey);
      triedKeys.add(lease.apiKey);
      onExecMeta?.({
        slotId: lease.slotId,
        maskedKey: lease.maskedKey,
        accountLabel: lease.label,
        execMode: "fresh"
      });
      let yieldedAny = false;

      try {
        const resolved = await this.resolveModel(lease.apiKey, turn.requestedModel, turn.rawBody);
        try {
          for await (const ev of this.runFreshExecution(lease.apiKey, turn, resolved)) {
            yieldedAny = true;
            yield ev;
          }
          lease.markSuccess();
          return;
        } catch (execErr) {
          // Resilient parameter fallback: if Cursor backend rejects model parameters with
          // "Invalid parameters for registry model", retry with stripped params before throwing.
          const msg = execErr instanceof Error ? execErr.message : String(execErr);
          if (!yieldedAny && resolved.selection.params && resolved.selection.params.length > 0 && /invalid parameters for registry model/i.test(msg)) {
            const bareResolved = {
              selection: { id: resolved.selection.id },
              canonicalId: resolved.selection.id
            };
            for await (const ev of this.runFreshExecution(lease.apiKey, turn, bareResolved)) {
              yieldedAny = true;
              yield ev;
            }
            lease.markSuccess();
            return;
          }
          throw execErr;
        }
      } catch (err) {
        const gwErr = mapSdkError(err);
        const retryableOnAnotherKey = this.classifyAndReportKeyFailure(
          keyPool,
          lease.apiKey,
          turn.requestedModel,
          gwErr
        );

        const canRetry = !yieldedAny
          && retryableOnAnotherKey
          && keyPool.enabledKeyCount() > 0
          && attempt + 1 < maxAttempts;

        if (!canRetry) throw gwErr;
      } finally {
        lease.release();
      }
    }
  }

  private classifyAndReportKeyFailure(
    keyPool: UpstreamKeyPool,
    apiKey: string,
    requestedModel: string,
    err: GatewayError
  ): boolean {
    // mapSdkError turns upstream auth failures into 502/upstream_auth_error, so match on the code, not 401.
    if (err.code === "upstream_auth_error" || err.status === 401) {
      keyPool.reportAuthFailure(apiKey, err.message);
      return true;
    }
    if (isQuotaOrBillingExhaustedError(err)) {
      keyPool.reportQuotaExhausted(apiKey, requestedModel, err.message);
      return true;
    }
    if (err.status === 429) {
      keyPool.reportRateLimit(apiKey);
      return true;
    }
    return false;
  }

  private async *resumeParkedExecution(
    exec: LiveExecution,
    turn: ParsedProtocolTurn
  ): AsyncGenerator<GatewayStreamEvent, void, unknown> {
    const queue = new AsyncEventQueue<GatewayStreamEvent>();
    exec.activeQueue = queue;
    exec.execMode = "parked_tool_resume";
    exec.pendId = crypto.randomBytes(6).toString("hex");
    exec.outputChars = 0;
    exec.reasoningChars = 0;
    exec.lastSdkMetrics = null;

    const resultsByCallId = new Map<string, { text: string; images: NormalizedImage[]; isError: boolean }>();
    for (const tr of turn.trailingToolResults) {
      const formatted = tr.isError ? `[Error]: ${tr.content}` : tr.content;
      resultsByCallId.set(tr.toolCallId, { text: formatted || (tr.images?.length ? "" : "[ok]"), images: tr.images ?? [], isError: !!tr.isError });
    }

    const entries = [...exec.emittedParkMap.values()];
    exec.emittedParkMap.clear();

    let deltaCharsSent = 0;
    entries.forEach((entry, idx) => {
      // A missing result must never be faked as success: the model would believe the tool ran fine.
      const res = resultsByCallId.get(entry.externalId) ?? {
        text: "[Error]: the client did not return a result for this tool call.",
        images: [],
        isError: true
      };
      let text = res.text;
      const isLast = idx === entries.length - 1;
      if (isLast && turn.trailingUserText?.trim()) {
        text += `${text ? "\n\n" : ""}[User]: ${turn.trailingUserText.trim()}`;
      }
      const images = [...res.images, ...(isLast ? turn.trailingImages ?? [] : [])];
      deltaCharsSent += text.length;
      entry.deferred.resolve(buildToolResultPayload(text, images, res.isError));
    });

    // Prior context stays warm inside the suspended cloud Agent Run; only `deltaTokens` is newly sent!
    const priorTotalContext = exec.inputTokensEstimate + exec.cachedContextTokensEstimate;
    const deltaTokens = Math.max(1, Math.ceil(deltaCharsSent / 4));
    exec.cachedContextTokensEstimate = priorTotalContext;
    exec.inputTokensEstimate = deltaTokens;

    // If additional parallel tool calls arrived while this run was parked, schedule their flush now
    // so they are returned to the caller instead of deadlocking until idle timeout.
    if (exec.pendingEntries.length > 0) {
      this.scheduleToolBatchFlush(exec);
    }

    yield* this.consumeQueueWithGuards(exec, queue, turn.signal);
  }

  private async *runIncrementalOnWarmAgent(
    warm: WarmAgentEntry,
    turn: ParsedProtocolTurn,
    resolvedModel: { selection: ModelSelection; canonicalId: string }
  ): AsyncGenerator<GatewayStreamEvent, void, unknown> {
    const activeTools = turn.toolChoice === "none" ? [] : turn.tools;
    const deltaPrompt = turn.incrementalUserText || "";
    const { exec, queue } = createLiveExecution({
      execMode: "warm_incremental",
      apiKey: warm.apiKey,
      canonicalModelId: resolvedModel.canonicalId,
      hasMcpTools: warm.hasMcpTools,
      agent: warm.agent,
      scope: turn.scope,
      currentInputPrefixHash: turn.currentInputPrefixHash,
      promptCharLength: deltaPrompt.length
    });

    const customTools = activeTools.length > 0 ? this.buildCustomTools(activeTools, exec) : undefined;
    const incImages = turn.incrementalImages ?? [];
    const sdkMessage: string | SDKUserMessage = incImages.length > 0
      ? { text: deltaPrompt, images: toSdkImages(incImages) }
      : deltaPrompt;

    try {
      const run = await warm.agent.send(sdkMessage, {
        model: resolvedModel.selection,
        mode: "agent",
        ...(customTools ? { local: { customTools } } : {})
      });
      exec.run = run;
      void this.pumpRunStream(exec, run);
    } catch (err) {
      await this.disposeExecution(exec, err);
      throw err;
    }

    yield* this.consumeQueueWithGuards(exec, queue, turn.signal);
  }

  private async *runFreshExecution(
    apiKey: string,
    turn: ParsedProtocolTurn,
    resolvedModel: { selection: ModelSelection; canonicalId: string }
  ): AsyncGenerator<GatewayStreamEvent, void, unknown> {
    const activeTools = turn.toolChoice === "none" ? [] : turn.tools;
    const nativeTools = turn.toolChoice === "none" || this.config.allowNativeWebTools === false ? [] : (turn.nativeSdkTools ?? []);
    const hasMcpTools = activeTools.length > 0;
    const sdkToolsList: Array<"mcp" | "webSearch" | "webFetch"> = [
      ...(hasMcpTools ? (["mcp"] as const) : []),
      ...nativeTools
    ];

    const promptParts: string[] = [];
    const toolHint = buildToolChoiceHint(activeTools, turn.toolChoice, dialogHasToolResults(turn));
    const visionHint = buildVisionGuardHint(turn);
    const systemText = [turn.systemPrompt?.trim(), toolHint, visionHint].filter(Boolean).join("\n\n");
    if (systemText) {
      promptParts.push(`<system>\n${systemText}\n</system>`);
    }
    promptParts.push(turn.fullTranscriptText);
    const promptText = promptParts.join("\n\n");

    let agent: SDKAgent;
    try {
      agent = await this.agentFactory({
        apiKey,
        model: resolvedModel.selection,
        mode: "agent",
        tools: sdkToolsList,
        local: {
          cwd: this.config.emptyWorkspaceDir,
          settingSources: [],
          store: this.memoryStore.store
        }
      });
    } catch (err) {
      throw mapSdkError(err);
    }

    const { exec, queue } = createLiveExecution({
      execMode: "fresh",
      apiKey,
      canonicalModelId: resolvedModel.canonicalId,
      hasMcpTools,
      agent,
      scope: turn.scope,
      // An agent that was granted native web tools must never be reused by a later request without them.
      currentInputPrefixHash: nativeTools.length > 0 ? undefined : turn.currentInputPrefixHash,
      promptCharLength: promptText.length
    });

    const customTools = hasMcpTools ? this.buildCustomTools(activeTools, exec) : undefined;
    const sdkMessage: string | SDKUserMessage = turn.images.length > 0
      ? { text: promptText, images: toSdkImages(turn.images) }
      : promptText;

    try {
      const run = await agent.send(sdkMessage, {
        model: resolvedModel.selection,
        mode: "agent",
        ...(customTools ? { local: { customTools } } : {})
      });
      exec.run = run;
      void this.pumpRunStream(exec, run);
    } catch (err) {
      await this.disposeExecution(exec, err);
      throw mapSdkError(err);
    }

    yield* this.consumeQueueWithGuards(exec, queue, turn.signal);
  }

  private buildCustomTools(tools: NormalizedTool[], exec: LiveExecution): Record<string, SDKCustomTool> {
    const record: Record<string, SDKCustomTool> = {};
    // Invalid-argument bounces already given per tool during this send; capped so a stubborn model still reaches the client.
    const argRetries = new Map<string, number>();
    let seq = 0;

    for (const tool of tools) {
      const toolName = tool.name.trim();
      if (!toolName) continue;
      const rawSchema = tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
        ? { ...tool.inputSchema }
        : {};
      if (!rawSchema.type) rawSchema.type = "object";
      if (rawSchema.type === "object" && !rawSchema.properties) {
        rawSchema.properties = {};
      }
      record[toolName] = {
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: rawSchema as Record<string, never>,
        execute: async (args, context) => {
          if (exec.disposed) throw new Error("Execution disposed");
          exec.onActivity?.();
          exec.hadToolCallsInRun = true;
          const sdkCallId = typeof context?.toolCallId === "string" ? context.toolCallId : undefined;

          if (sdkCallId) {
            const dup = exec.pendingEntries.find((e) => e.sdkCallId === sdkCallId)
              ?? [...exec.emittedParkMap.values()].find((e) => e.sdkCallId === sdkCallId);
            if (dup) return dup.deferred.promise;
          }

          const rawArgsObj = args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {};
          const argsObj = repairToolArgs(rawSchema, rawArgsObj);

          const problem = findToolArgsProblem(rawSchema, argsObj);
          if (problem) {
            const used = argRetries.get(toolName) ?? 0;
            if (used < MAX_TOOL_ARG_RETRIES) {
              argRetries.set(toolName, used + 1);
              return { content: [{ type: "text" as const, text: formatToolArgsError(toolName, problem) }], isError: true };
            }
          } else {
            argRetries.delete(toolName);
          }

          const externalId = `call_cgw_${exec.pendId}_${++seq}`;
          const deferred = createDeferred<ToolResultPayload>();

          exec.pendingEntries.push({
            sdkCallId,
            externalId,
            name: toolName,
            argsObject: argsObj,
            deferred
          });

          this.scheduleToolBatchFlush(exec);
          return deferred.promise;
        }
      };
    }

    return record;
  }

  private scheduleToolBatchFlush(exec: LiveExecution): void {
    if (exec.disposed || exec.pendingEntries.length === 0 || !exec.activeQueue) return;
    if (exec.batchTimer) clearTimeout(exec.batchTimer);

    const parkedSdkIds = new Set(exec.pendingEntries.map((e) => e.sdkCallId).filter(Boolean));
    let allExpectedArrived = true;
    for (const runningId of exec.expectedRunningCallIds) {
      if (!parkedSdkIds.has(runningId) && !exec.settledSdkCallIds.has(runningId)) {
        allExpectedArrived = false;
        break;
      }
    }

    const delayMs = allExpectedArrived
      ? this.config.toolBatchGraceMs
      : Math.max(this.config.toolBatchGraceMs * 4, 80);

    exec.batchTimer = setTimeout(() => {
      exec.batchTimer = null;
      this.flushParkedToolBatch(exec);
    }, delayMs);
    exec.batchTimer.unref?.();
  }

  private flushParkedToolBatch(exec: LiveExecution): void {
    if (exec.disposed || exec.pendingEntries.length === 0 || !exec.activeQueue) return;

    const batch = exec.pendingEntries.splice(0, exec.pendingEntries.length);
    const calls: NormalizedToolCall[] = [];

    for (const entry of batch) {
      exec.emittedParkMap.set(entry.externalId, entry);
      calls.push({
        id: entry.externalId,
        name: entry.name,
        argumentsJson: JSON.stringify(entry.argsObject),
        argsObject: entry.argsObject
      });
    }

    const queue = exec.activeQueue;
    exec.activeQueue = null;
    exec.onActivity = null;

    this.parkedPool.park(exec);

    const metrics = this.resolveMetrics(exec);
    this.usageTracker.recordTurn({
      apiKey: exec.apiKey,
      modelId: exec.canonicalModelId,
      mode: exec.execMode,
      metrics
    });

    queue.push({ type: "tool_calls", calls });
    queue.push({ type: "usage", metrics });
    queue.push({ type: "done", stopReason: "tool_calls" });
    queue.close();
  }

  private resolveMetrics(exec: LiveExecution): TurnTokenMetrics {
    if (exec.lastSdkMetrics) return exec.lastSdkMetrics;
    const outputTokens = Math.max(1, Math.ceil((exec.outputChars + exec.reasoningChars) / 4));
    const reasoningTokens = exec.reasoningChars > 0 ? Math.ceil(exec.reasoningChars / 4) : undefined;
    return {
      inputTokens: exec.inputTokensEstimate,
      outputTokens,
      cacheReadTokens: exec.cachedContextTokensEstimate,
      cacheWriteTokens: 0,
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {})
    };
  }

  private async pumpRunStream(exec: LiveExecution, run: Run): Promise<void> {
    try {
      for await (const msg of run.stream()) {
        if (exec.disposed) return;
        exec.onActivity?.();
        this.handleSdkStreamMessage(exec, msg);
      }

      if (exec.disposed) return;

      if (exec.pendingEntries.length > 0 && exec.activeQueue) {
        if (exec.batchTimer) {
          clearTimeout(exec.batchTimer);
          exec.batchTimer = null;
        }
        this.flushParkedToolBatch(exec);
        return;
      }

      if (run.status === "error" && run.error) {
        throw new GatewayError(run.error.message || "Cursor run failed.", 502, run.error.code || "cursor_run_error");
      }

      const metrics = this.resolveMetrics(exec);
      this.usageTracker.recordTurn({
        apiKey: exec.apiKey,
        modelId: exec.canonicalModelId,
        mode: exec.execMode,
        metrics
      });

      const queue = exec.activeQueue;
      exec.activeQueue = null;
      if (queue) {
        queue.push({ type: "usage", metrics });
        queue.push({ type: "done", stopReason: "stop" });
        queue.close();
      }

      if (!this.warmPool.store(exec)) {
        await this.disposeExecution(exec);
      }
    } catch (err) {
      if (exec.disposed) return;
      const mapped = mapSdkError(err);
      const queue = exec.activeQueue;
      exec.activeQueue = null;
      if (queue) queue.fail(mapped);
      await this.disposeExecution(exec, mapped);
    }
  }

  private handleSdkStreamMessage(exec: LiveExecution, msg: SDKMessage): void {
    switch (msg.type) {
      case "thinking": {
        if (msg.text && exec.activeQueue) {
          exec.reasoningChars += msg.text.length;
          exec.activeQueue.push({ type: "thinking", text: msg.text });
        }
        break;
      }
      case "assistant": {
        if (!Array.isArray(msg.message?.content)) break;
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text && exec.activeQueue) {
            exec.outputChars += block.text.length;
            exec.assistantTextAccumulator += block.text;
            exec.activeQueue.push({ type: "text", text: block.text });
          }
        }
        break;
      }
      case "tool_call": {
        exec.hadToolCallsInRun = true;
        const callId = msg.call_id;
        if (callId) {
          if (msg.status === "running") exec.expectedRunningCallIds.add(callId);
          else if (msg.status === "completed" || msg.status === "error") {
            exec.expectedRunningCallIds.delete(callId);
            exec.settledSdkCallIds.add(callId);
          }
          if (exec.pendingEntries.length > 0) this.scheduleToolBatchFlush(exec);
        }
        break;
      }
      case "usage": {
        const u = msg.usage as unknown as Record<string, unknown> | undefined;
        if (u && typeof u === "object") {
          const inputTokens = typeof u.inputTokens === "number" ? u.inputTokens : exec.inputTokensEstimate;
          const outputTokens = typeof u.outputTokens === "number"
            ? u.outputTokens
            : Math.max(1, Math.ceil(exec.outputChars / 4));
          const cacheReadTokens = typeof u.cacheReadTokens === "number" ? u.cacheReadTokens : 0;
          const cacheWriteTokens = typeof u.cacheWriteTokens === "number" ? u.cacheWriteTokens : 0;
          const reasoningTokens = typeof u.reasoningTokens === "number" ? u.reasoningTokens : undefined;
          exec.lastSdkMetrics = {
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            ...(reasoningTokens !== undefined ? { reasoningTokens } : {})
          };
        }
        break;
      }
      case "status": {
        if (msg.status === "ERROR" && msg.message && exec.activeQueue) {
          exec.activeQueue.fail(new GatewayError(msg.message, 502, "cursor_status_error"));
        }
        break;
      }
      default:
        break;
    }
  }

  private async *consumeQueueWithGuards(
    exec: LiveExecution,
    queue: AsyncEventQueue<GatewayStreamEvent>,
    signal?: AbortSignal
  ): AsyncGenerator<GatewayStreamEvent, void, unknown> {
    let idleTimer: NodeJS.Timeout | null = null;
    let maxTimer: NodeJS.Timeout | null = null;
    let finishedTurnCleanly = false;

    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const err = new GatewayError(
          `Upstream idle timeout after ${this.config.runIdleTimeoutMs}ms`,
          504,
          "gateway_idle_timeout"
        );
        queue.fail(err);
        void this.disposeExecution(exec, err);
      }, this.config.runIdleTimeoutMs);
      idleTimer.unref?.();
    };

    resetIdle();
    exec.onActivity = resetIdle;

    maxTimer = setTimeout(() => {
      const err = new GatewayError(
        `Upstream max turn timeout after ${this.config.runMaxTimeoutMs}ms`,
        504,
        "gateway_max_timeout"
      );
      queue.fail(err);
      void this.disposeExecution(exec, err);
    }, this.config.runMaxTimeoutMs);
    maxTimer.unref?.();

    const onAbort = () => {
      if (finishedTurnCleanly) return;
      const err = new GatewayError("Client disconnected or aborted request.", 499, "client_cancelled");
      queue.fail(err);
      void this.disposeExecution(exec, err);
    };

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      for await (const event of queue) {
        if (event.type === "done") finishedTurnCleanly = true;
        yield event;
      }
      finishedTurnCleanly = true;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (exec.onActivity === resetIdle) exec.onActivity = null;
      if (signal) signal.removeEventListener("abort", onAbort);

      if (!finishedTurnCleanly && !this.parkedPool.has(exec.pendId)) {
        await this.disposeExecution(exec, new Error("Stream consumer exited early"));
      }
    }
  }

  private async closeAndPurgeAgent(agent: SDKAgent): Promise<void> {
    try {
      agent.close();
      await Promise.race([
        agent[Symbol.asyncDispose]().catch(() => undefined),
        new Promise((r) => setTimeout(r, 1500).unref?.())
      ]);
    } catch {
      // Ignore cleanup error
    } finally {
      this.memoryStore.purgeAgent(agent.agentId);
      this.purgeSdkTranscriptArtifact(agent.agentId);
    }
  }

  private async disposeExecution(exec: LiveExecution, reason?: unknown): Promise<void> {
    if (exec.disposed) return;
    exec.disposed = true;
    this.parkedPool.delete(exec.pendId);

    if (exec.batchTimer) clearTimeout(exec.batchTimer);
    if (exec.ttlTimer) clearTimeout(exec.ttlTimer);

    const rejectReason = reason ?? new Error("Execution disposed");
    for (const p of exec.pendingEntries) p.deferred.reject(rejectReason);
    exec.pendingEntries.length = 0;
    for (const p of exec.emittedParkMap.values()) p.deferred.reject(rejectReason);
    exec.emittedParkMap.clear();

    try {
      if (exec.run && exec.run.status === "running" && exec.run.supports("cancel")) {
        await Promise.race([
          exec.run.cancel().catch(() => undefined),
          new Promise((r) => setTimeout(r, 2000).unref?.())
        ]);
      }
    } catch {
      // Ignore cancel cleanup errors
    }

    await this.closeAndPurgeAgent(exec.agent);
  }

  private sdkProjectDir(): string {
    let resolved = this.config.emptyWorkspaceDir;
    try {
      resolved = realpathSync(resolved);
    } catch {
      // Directory may not exist yet in pure unit tests
    }
    const sanitizedWorkspace = resolved
      .replace(/[^a-zA-Z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    const dataRoot = process.env.CURSOR_DATA_DIR?.trim() || path.join(homedir(), ".cursor");
    return path.join(dataRoot, "projects", sanitizedWorkspace);
  }

  /** Remove only THIS agent's transcript files (async, never blocks the event loop). */
  private purgeSdkTranscriptArtifact(agentId: string): void {
    if (!agentId || agentId === "unimplemented-agent") return;
    const transcriptDir = path.join(this.sdkProjectDir(), "agent-transcripts");
    void Promise.allSettled([
      rm(path.join(transcriptDir, agentId), { recursive: true, force: true }),
      rm(path.join(transcriptDir, `${agentId}.json`), { force: true }),
      rm(path.join(transcriptDir, `${agentId}.jsonl`), { force: true })
    ]);
  }

  /**
   * Low-frequency sweep of uploaded image assets. Only files older than the longest possible run
   * (+ parked TTL + margin) are removed, so a still-running or parked request never loses its images.
   */
  async sweepStaleAssets(): Promise<void> {
    const minAgeMs = this.config.runMaxTimeoutMs + this.config.parkedRunTtlMs + 5 * 60 * 1000;
    const cutoff = Date.now() - minAgeMs;
    const projectDir = this.sdkProjectDir();
    for (const sub of ["assets", "agent-transcripts"]) {
      const dir = path.join(projectDir, sub);
      try {
        for (const name of await readdir(dir)) {
          const fp = path.join(dir, name);
          const st = await stat(fp).catch(() => null);
          if (st && st.mtimeMs < cutoff) await rm(fp, { recursive: true, force: true }).catch(() => undefined);
        }
      } catch {
        // dir may not exist yet
      }
    }
  }
}
