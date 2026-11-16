import crypto from "node:crypto";
import type { Run, SDKAgent } from "@cursor/sdk";
import type { ExecutionModeTag } from "../services/usage-tracker.js";
import { AsyncEventQueue, type Deferred } from "../utils/async.js";
import { extendHashWithAssistantReply, normalizeBaseModelId } from "../utils/hash.js";
import type { GatewayStreamEvent, NormalizedToolResult, TurnTokenMetrics } from "./types.js";

export type ToolResultPayload =
  | string
  | { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType?: string }>; isError?: boolean };

export interface ParkedToolEntry {
  sdkCallId?: string;
  externalId: string;
  name: string;
  argsObject: Record<string, unknown>;
  deferred: Deferred<ToolResultPayload>;
}

export interface LiveExecution {
  pendId: string;
  execMode: ExecutionModeTag;
  apiKey: string;
  canonicalModelId: string;
  hasMcpTools: boolean;
  agent: SDKAgent;
  scope: string;
  run?: Run;
  currentInputPrefixHash?: string;
  assistantTextAccumulator: string;
  hadToolCallsInRun: boolean;
  expectedRunningCallIds: Set<string>;
  settledSdkCallIds: Set<string>;
  pendingEntries: ParkedToolEntry[];
  emittedParkMap: Map<string, ParkedToolEntry>;
  batchTimer: NodeJS.Timeout | null;
  ttlTimer: NodeJS.Timeout | null;
  activeQueue: AsyncEventQueue<GatewayStreamEvent> | null;
  onActivity: (() => void) | null;
  inputTokensEstimate: number;
  cachedContextTokensEstimate: number;
  outputChars: number;
  reasoningChars: number;
  lastSdkMetrics: TurnTokenMetrics | null;
  disposed: boolean;
}

export interface WarmAgentEntry {
  expectedPrefixHash: string;
  apiKey: string;
  canonicalModelId: string;
  hasMcpTools: boolean;
  agent: SDKAgent;
  scope: string;
  ttlTimer: NodeJS.Timeout;
}

/** Canonical "same model" key: lower-case, no `[params]`, no `-fast`/`-slow` suffix (shared by both pools). */
export function baseModelId(id: string): string {
  return normalizeBaseModelId(id);
}

/** Warm LRU Map key: tenant scope + canonical model + dialog prefix hash. */
export function warmStoreKey(scope: string, canonicalModelId: string, prefixHash: string): string {
  return `${scope}|${baseModelId(canonicalModelId)}|${prefixHash}`;
}

function isAutoModel(base: string): boolean {
  return base === "auto" || base === "default";
}

const TOOL_CALL_ID_REGEX = /^call_cgw_([a-f0-9]{12})_(\d+)$/;

export function createLiveExecution(params: {
  execMode: ExecutionModeTag;
  apiKey: string;
  canonicalModelId: string;
  hasMcpTools: boolean;
  agent: SDKAgent;
  scope?: string;
  currentInputPrefixHash?: string;
  promptCharLength: number;
}): { exec: LiveExecution; queue: AsyncEventQueue<GatewayStreamEvent> } {
  const queue = new AsyncEventQueue<GatewayStreamEvent>();
  const exec: LiveExecution = {
    pendId: crypto.randomBytes(6).toString("hex"),
    execMode: params.execMode,
    apiKey: params.apiKey,
    canonicalModelId: params.canonicalModelId,
    hasMcpTools: params.hasMcpTools,
    agent: params.agent,
    scope: params.scope ?? "",
    currentInputPrefixHash: params.currentInputPrefixHash,
    assistantTextAccumulator: "",
    hadToolCallsInRun: false,
    expectedRunningCallIds: new Set(),
    settledSdkCallIds: new Set(),
    pendingEntries: [],
    emittedParkMap: new Map(),
    batchTimer: null,
    ttlTimer: null,
    activeQueue: queue,
    onActivity: null,
    inputTokensEstimate: Math.max(1, Math.ceil(params.promptCharLength / 4)),
    cachedContextTokensEstimate: 0,
    outputChars: 0,
    reasoningChars: 0,
    lastSdkMetrics: null,
    disposed: false
  };
  return { exec, queue };
}

/**
 * Manages active SDK runs that are temporarily parked waiting for client `tool_result` callbacks.
 */
export class ParkedToolPool {
  private readonly map = new Map<string, LiveExecution>();
  private readonly maxItems: number;
  private readonly ttlMs: number;
  private readonly onDispose: (exec: LiveExecution, reason: Error) => Promise<void>;

  constructor(opts: {
    maxItems: number;
    ttlMs: number;
    onDispose: (exec: LiveExecution, reason: Error) => Promise<void>;
  }) {
    this.maxItems = opts.maxItems;
    this.ttlMs = opts.ttlMs;
    this.onDispose = opts.onDispose;
  }

  get size(): number {
    return this.map.size;
  }

  has(pendId: string): boolean {
    return this.map.has(pendId);
  }

  delete(pendId: string): void {
    this.map.delete(pendId);
  }

  park(exec: LiveExecution): void {
    if (this.maxItems <= 0) {
      void this.onDispose(exec, new Error("Parked tool pool disabled (MAX_PARKED_RUNS=0)"));
      return;
    }
    while (this.map.size >= this.maxItems) {
      const oldestKey = this.map.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (oldest) void this.onDispose(oldest, new Error("Evicted oldest parked tool session"));
    }

    exec.ttlTimer = setTimeout(() => {
      this.map.delete(exec.pendId);
      void this.onDispose(exec, new Error("Parked tool session TTL expired"));
    }, this.ttlMs);
    exec.ttlTimer.unref?.();

    this.map.set(exec.pendId, exec);
  }

  /**
   * Peek or claim a parked tool execution matching `trailingToolResults`.
   * Preserves account affinity so multi-account pools resume on the exact owning `SDKAgent`.
   */
  tryClaim(trailingToolResults: readonly NormalizedToolResult[], requestedBaseModel: string, scope = ""): LiveExecution | null {
    if (!trailingToolResults.length) return null;

    const pendIds = new Set<string>();
    for (const tr of trailingToolResults) {
      const m = TOOL_CALL_ID_REGEX.exec(tr.toolCallId);
      if (!m) return null;
      pendIds.add(m[1]);
    }
    if (pendIds.size !== 1) return null;
    const pendId = [...pendIds][0];
    const exec = this.map.get(pendId);
    if (!exec || exec.disposed || exec.scope !== scope) return null;

    const execBase = baseModelId(exec.canonicalModelId);
    const reqBase = baseModelId(requestedBaseModel);
    if (execBase !== reqBase && !isAutoModel(reqBase)) {
      this.map.delete(pendId);
      void this.onDispose(exec, new Error("Model changed mid-tool-turn; falling back to stateless replay"));
      return null;
    }

    for (const requiredId of exec.emittedParkMap.keys()) {
      if (!trailingToolResults.some((r) => r.toolCallId === requiredId)) {
        this.map.delete(pendId);
        void this.onDispose(exec, new Error("Incomplete tool results; falling back to stateless replay"));
        return null;
      }
    }

    this.map.delete(pendId);
    if (exec.ttlTimer) {
      clearTimeout(exec.ttlTimer);
      exec.ttlTimer = null;
    }
    return exec;
  }

  drainAll(): LiveExecution[] {
    const items = [...this.map.values()];
    this.map.clear();
    return items;
  }
}

/**
 * LRU pool of completed text-only Agents kept warm in RAM for O(1) incremental delta reuse.
 */
export class WarmAgentPool {
  private readonly map = new Map<string, WarmAgentEntry>();
  private readonly maxItems: number;
  private readonly ttlMs: number;
  private readonly onCloseAgent: (agent: SDKAgent) => Promise<void>;

  constructor(opts: {
    maxItems: number;
    ttlMs: number;
    onCloseAgent: (agent: SDKAgent) => Promise<void>;
  }) {
    this.maxItems = opts.maxItems;
    this.ttlMs = opts.ttlMs;
    this.onCloseAgent = opts.onCloseAgent;
  }

  get size(): number {
    return this.map.size;
  }

  store(exec: LiveExecution): boolean {
    if (
      exec.disposed ||
      exec.hadToolCallsInRun ||
      !exec.currentInputPrefixHash ||
      !exec.assistantTextAccumulator.trim() ||
      this.maxItems <= 0
    ) {
      return false;
    }

    const expectedPrefixHash = extendHashWithAssistantReply(
      exec.currentInputPrefixHash,
      exec.assistantTextAccumulator
    );
    const mapKey = warmStoreKey(exec.scope, exec.canonicalModelId, expectedPrefixHash);

    while (this.map.size >= this.maxItems) {
      const oldestKey = this.map.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (oldest) {
        clearTimeout(oldest.ttlTimer);
        void this.onCloseAgent(oldest.agent);
      }
    }

    // Two identical dialogs in the same scope+model finishing concurrently: retire the old entry
    // first, otherwise its timer would later delete (and close) the NEW entry.
    const existing = this.map.get(mapKey);
    if (existing) {
      this.map.delete(mapKey);
      clearTimeout(existing.ttlTimer);
      void this.onCloseAgent(existing.agent);
    }

    exec.disposed = true;
    const agent = exec.agent;
    const ttlTimer = setTimeout(() => {
      // Only remove our own entry; never one that replaced us.
      if (this.map.get(mapKey)?.agent === agent) {
        this.map.delete(mapKey);
      }
      void this.onCloseAgent(agent);
    }, this.ttlMs);
    ttlTimer.unref?.();

    this.map.set(mapKey, {
      expectedPrefixHash,
      apiKey: exec.apiKey,
      canonicalModelId: exec.canonicalModelId,
      hasMcpTools: exec.hasMcpTools,
      agent,
      scope: exec.scope,
      ttlTimer
    });
    return true;
  }

  tryClaim(params: {
    priorPrefixHash?: string;
    incrementalUserText?: string;
    hasTrailingToolResults: boolean;
    hasMcpTools: boolean;
    requestedBaseModel: string;
    scope?: string;
    isKeyUsable: (apiKey: string) => boolean;
  }): WarmAgentEntry | null {
    if (
      !params.priorPrefixHash ||
      params.incrementalUserText === undefined ||
      params.hasTrailingToolResults
    ) {
      return null;
    }
    const scope = params.scope ?? "";
    const reqBase = baseModelId(params.requestedBaseModel);
    let mapKey: string | undefined;
    let entry: WarmAgentEntry | undefined;
    if (isAutoModel(reqBase)) {
      for (const [key, candidate] of this.map) {
        if (candidate.expectedPrefixHash === params.priorPrefixHash && candidate.scope === scope) {
          mapKey = key;
          entry = candidate;
          break;
        }
      }
    } else {
      mapKey = warmStoreKey(scope, params.requestedBaseModel, params.priorPrefixHash);
      entry = this.map.get(mapKey);
    }
    if (!mapKey || !entry || entry.scope !== scope) return null;

    const entryBase = baseModelId(entry.canonicalModelId);

    if (entry.hasMcpTools !== params.hasMcpTools || (entryBase !== reqBase && !isAutoModel(reqBase))) {
      return null;
    }

    this.map.delete(mapKey);
    clearTimeout(entry.ttlTimer);

    // If that account was disabled or entered 429 cooldown in the meantime, discard it cleanly!
    if (!params.isKeyUsable(entry.apiKey)) {
      void this.onCloseAgent(entry.agent);
      return null;
    }

    return entry;
  }

  async drainAll(): Promise<void> {
    const items = [...this.map.values()];
    this.map.clear();
    for (const w of items) clearTimeout(w.ttlTimer);
    await Promise.allSettled(items.map((w) => this.onCloseAgent(w.agent)));
  }
}
