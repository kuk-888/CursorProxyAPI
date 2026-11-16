export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly param?: string;

  constructor(message: string, status = 500, code = "internal_error", param?: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
    this.param = param;
  }
}

export type LbStrategy = "quota-aware" | "least-busy" | "round-robin";

export interface NormalizedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export type NormalizedImage =
  | { url: string; dimension?: { width: number; height: number } }
  | { data: string; mimeType: string; dimension?: { width: number; height: number } };

export interface NormalizedToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  argsObject: Record<string, unknown>;
}

export interface NormalizedToolResult {
  toolCallId: string;
  name?: string;
  content: string;
  isError?: boolean;
  /** Images returned by the tool (inline base64 only; delivered to the parked SDK run). */
  images?: NormalizedImage[];
}

export type ToolChoiceMode =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; name: string };

/**
 * Pure protocol-parsed turn representation (decoupled from upstream `apiKey` selection).
 */
export interface ParsedProtocolTurn {
  requestedModel: string;
  rawBody: Record<string, unknown>;
  /** Deterministic or header-derived conversation key for CPA-style 1h sticky Session Affinity. */
  conversationKey?: string;
  systemPrompt?: string;
  fullTranscriptText: string;
  priorPrefixHash?: string;
  currentInputPrefixHash?: string;
  incrementalUserText?: string;
  images: NormalizedImage[];
  incrementalImages?: NormalizedImage[];
  tools: NormalizedTool[];
  /** Native Cursor cloud tools requested by caller (e.g. `webSearch`, `webFetch` from `type: "web_search"`). */
  nativeSdkTools?: Array<"webSearch" | "webFetch">;
  toolChoice: ToolChoiceMode;
  trailingToolResults: NormalizedToolResult[];
  trailingUserText?: string;
  /** Images attached to the trailing user message that follows tool results. */
  trailingImages?: NormalizedImage[];
  stream: boolean;
  includeStreamUsage?: boolean;
  hasToolResults?: boolean;
  estimatedInputTokens: number;
  signal?: AbortSignal;
  /** Client identity (sub-key id or "master"); isolates warm/parked sessions between clients. */
  scope?: string;
}

export interface TurnTokenMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens?: number;
}

export type GatewayStreamEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_calls"; calls: NormalizedToolCall[] }
  | { type: "usage"; metrics: TurnTokenMetrics }
  | { type: "done"; stopReason: "stop" | "tool_calls" | "length" };

export interface AutoDisabledState {
  /** `quota`: ran out of quota (recovers by itself); `auth`: upstream rejected the key (needs a manual re-check). */
  kind: "quota" | "auth";
  reason: string;
  /** Epoch ms of the expected recovery (billing cycle end), when known. */
  resetAtMs?: number;
}

export interface GatewayConfig {
  host: string;
  port: number;
  /** Trust X-Forwarded-For / X-Real-IP headers: "loopback" (default), "all", or "off". */
  trustProxy?: "loopback" | "all" | "off";
  gatewayTokens: Set<string>;
  /** Dedicated admin console password. If unset the admin console is disabled (never falls back to client tokens). */
  adminPassword?: string;
  /** Mount the optional Web Console & `/v1/admin/*` management API (default `true`; set `false` for pure headless proxy). */
  enableDashboard: boolean;
  /** Allow clients to enable Cursor-side webSearch/webFetch via `web_search*` / `web_fetch` tools. */
  allowNativeWebTools?: boolean;
  /** Custom URL path for the management console (default `/dashboard`, e.g. `/adm-7f3c9a`). */
  dashboardPath: string;
  cursorApiKeys: string[];
  disabledCursorApiKeys: string[];
  /** Disabled base model IDs persisted in `.env` as `DISABLED_MODELS`. */
  disabledModels: string[];
  /** Optional `slotId:label` map persisted in `.env` as `KEY_LABELS`. */
  keyLabels: Record<string, string>;
  /** Persisted auto-disable state per slot (`KEY_AUTO_DISABLED`), so recovery survives restarts. */
  keyAutoDisabled?: Record<string, AutoDisabledState>;
  lbStrategy: LbStrategy;
  /** CPA-style sticky session affinity so multi-turn conversations stay on the same account. */
  sessionAffinityEnabled: boolean;
  sessionAffinityTtlMs: number;
  /** Automatically disable/trip accounts that run out of quota or return 401/402. */
  autoDisableExhaustedKeys: boolean;
  envFilePath?: string;
  /** Directory for persistent runtime state (`gateway-keys.json`, `admin-session.key`, `usage-ledger.json`). */
  dataDir?: string;
  /** Where the overview ledger (metadata only, no conversation text) is persisted; unset = memory only. */
  usageLedgerFile?: string;
  /** Record the client IP in the overview ledger (default `true`). */
  recordClientIp?: boolean;
  runIdleTimeoutMs: number;
  runMaxTimeoutMs: number;
  parkedRunTtlMs: number;
  maxParkedRuns: number;
  warmSessionTtlMs: number;
  maxWarmSessions: number;
  keyCooldownMs: number;
  toolBatchGraceMs: number;
  /** Default max in-flight requests per managed client key when the key has no own limit (0 = unlimited). */
  clientKeyMaxConcurrent: number;
  maxBodyBytes: number;
  emptyWorkspaceDir: string;
}
