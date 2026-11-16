import crypto from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GatewayError, type GatewayConfig } from "../core/types.js";
import { safeStringEquals } from "../utils/hash.js";
import { normalizeBaseModelId } from "./model-access.js";

export interface ClientKeyStats {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  lastUsedAt?: string;
}

export interface ClientGatewayKeyView {
  id: string;
  name: string;
  maskedToken: string;
  enabled: boolean;
  allowAllModels: boolean;
  allowedModels: string[];
  /** Maximum total requests allowed; `null` = unlimited. */
  maxRequests: number | null;
  /** Max simultaneous in-flight requests for this key; `null` = use the gateway default (unlimited unless configured). */
  maxConcurrent: number | null;
  /** ISO-8601 expiration timestamp; `null` = never expires. */
  expiresAt: string | null;
  isExpired: boolean;
  isQuotaExhausted: boolean;
  createdAt: string;
  stats: ClientKeyStats;
}

interface InternalClientKey {
  id: string;
  name: string;
  token: string;
  enabled: boolean;
  allowAllModels: boolean;
  allowedModels: Set<string>;
  maxRequests: number | null;
  maxConcurrent: number | null;
  expiresAt: string | null;
  createdAt: string;
  stats: ClientKeyStats;
}

export type AuthenticatedClientIdentity =
  | {
      kind: "gateway_key";
      keyId: string;
      keyName: string;
      allowAllModels: boolean;
      allowedModels: ReadonlySet<string>;
    };

function maskGatewayToken(tok: string): string {
  if (tok.length < 24) return `${tok.slice(0, 2)}***`;
  return `${tok.slice(0, 8)}...${tok.slice(-4)}`;
}

function normalizeMaxRequests(val: unknown): number | null {
  if (val === null || val === undefined || val === "" || val === 0) return null;
  const n = typeof val === "number" ? Math.floor(val) : Number.parseInt(String(val), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeExpiresAt(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val !== "string" || !val.trim()) return null;
  const ms = Date.parse(val.trim());
  if (!Number.isFinite(ms)) {
    throw new GatewayError("过期时间格式无效，请提供合法的日期时间。", 400, "invalid_expires_at");
  }
  return new Date(ms).toISOString();
}

export class ClientGatewayKeyManager {
  private readonly keys: InternalClientKey[] = [];
  private readonly stateFilePath?: string;
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(config: Pick<GatewayConfig, "gatewayTokens" | "envFilePath" | "dataDir">) {
    const dir = config.dataDir ?? (config.envFilePath ? path.dirname(config.envFilePath) : undefined);
    if (dir) {
      this.stateFilePath = path.join(dir, "gateway-keys.json");
    }
    this.loadAndSeed(config.gatewayTokens);
  }

  private loadAndSeed(envTokens: ReadonlySet<string>): void {
    let loadedFromFile = false;
    if (this.stateFilePath && existsSync(this.stateFilePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.stateFilePath, "utf8")) as unknown;
        if (Array.isArray(raw)) {
          loadedFromFile = true;
          for (const item of raw) {
            if (!item || typeof item !== "object") continue;
            const rec = item as Record<string, unknown>;
            const token = typeof rec.token === "string" ? rec.token.trim() : "";
            if (!token) continue;
            const allowedList = Array.isArray(rec.allowedModels)
              ? rec.allowedModels.filter((x): x is string => typeof x === "string").map((m) => normalizeBaseModelId(m))
              : [];
            const st = rec.stats && typeof rec.stats === "object" ? (rec.stats as Record<string, unknown>) : {};
            let expiresAt: string | null = null;
            try {
              expiresAt = normalizeExpiresAt(rec.expiresAt);
            } catch {
              expiresAt = null;
            }
            this.keys.push({
              id: typeof rec.id === "string" && rec.id ? rec.id : `gk_${crypto.randomBytes(4).toString("hex")}`,
              name: typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : "网关密钥",
              token,
              enabled: rec.enabled !== false,
              allowAllModels: rec.allowAllModels !== false,
              allowedModels: new Set(allowedList),
              maxRequests: normalizeMaxRequests(rec.maxRequests),
              maxConcurrent: normalizeMaxRequests(rec.maxConcurrent),
              expiresAt,
              createdAt: typeof rec.createdAt === "string" ? rec.createdAt : new Date().toISOString(),
              stats: {
                requests: typeof st.requests === "number" ? st.requests : 0,
                inputTokens: typeof st.inputTokens === "number" ? st.inputTokens : 0,
                outputTokens: typeof st.outputTokens === "number" ? st.outputTokens : 0,
                ...(typeof st.lastUsedAt === "string" ? { lastUsedAt: st.lastUsedAt } : {})
              }
            });
          }
        }
      } catch {
        // Fall through to env seeding
      }
    }

    let addedSeed = false;
    let idx = 0;
    for (const tok of envTokens) {
      if (!this.keys.some((k) => k.token === tok)) {
        idx += 1;
        this.keys.push({
          id: `gk_${crypto.createHash("sha256").update(tok).digest("hex").slice(0, 8)}`,
          name: idx === 1 && !loadedFromFile ? "默认主网关密钥" : `环境变量密钥 #${idx}`,
          token: tok,
          enabled: true,
          allowAllModels: true,
          allowedModels: new Set(),
          maxRequests: null,
          maxConcurrent: null,
          expiresAt: null,
          createdAt: new Date().toISOString(),
          stats: { requests: 0, inputTokens: 0, outputTokens: 0 }
        });
        addedSeed = true;
      }
    }

    if (addedSeed) this.persist();
  }

  private persist(): void {
    if (!this.stateFilePath) return;
    const payload = this.keys.map((k) => ({
      id: k.id,
      name: k.name,
      token: k.token,
      enabled: k.enabled,
      allowAllModels: k.allowAllModels,
      allowedModels: [...k.allowedModels].sort(),
      maxRequests: k.maxRequests,
      maxConcurrent: k.maxConcurrent,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      stats: k.stats
    }));
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const dir = path.dirname(this.stateFilePath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.stateFilePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // Ignore
    }
    renameSync(tmpPath, this.stateFilePath);
  }

  private schedulePersist(): void {
    if (!this.stateFilePath || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        this.persist();
      } catch {
        // Best-effort periodic flush
      }
    }, 2000);
    this.persistTimer.unref?.();
  }

  /** Effective concurrency cap for a key: its own setting, else the gateway default (0 = unlimited). */
  concurrencyLimitFor(keyId: string, defaultLimit: number): number {
    const k = this.keys.find((x) => x.id === keyId);
    return k?.maxConcurrent ?? defaultLimit;
  }

  authenticateClient(clientToken: string, opts: { checkQuotaCap?: boolean } = {}): AuthenticatedClientIdentity {
    const trimmed = clientToken.trim();
    let matchedManaged: InternalClientKey | undefined;
    for (const k of this.keys) {
      if (safeStringEquals(k.token, trimmed)) {
        matchedManaged = k;
      }
    }

    if (matchedManaged) {
      if (!matchedManaged.enabled) {
        throw new GatewayError(`Gateway API key '${matchedManaged.name}' is disabled.`, 403, "api_key_disabled");
      }
      if (matchedManaged.expiresAt && Date.now() >= Date.parse(matchedManaged.expiresAt)) {
        throw new GatewayError(
          `Gateway API key '${matchedManaged.name}' expired at ${matchedManaged.expiresAt}.`,
          403,
          "api_key_expired"
        );
      }
      if (
        opts.checkQuotaCap !== false &&
        matchedManaged.maxRequests !== null &&
        matchedManaged.stats.requests >= matchedManaged.maxRequests
      ) {
        throw new GatewayError(
          `Gateway API key '${matchedManaged.name}' has reached its maximum request limit (${matchedManaged.stats.requests}/${matchedManaged.maxRequests}).`,
          429,
          "api_key_quota_exceeded"
        );
      }
      return {
        kind: "gateway_key",
        keyId: matchedManaged.id,
        keyName: matchedManaged.name,
        allowAllModels: matchedManaged.allowAllModels,
        allowedModels: matchedManaged.allowedModels
      };
    }

    // 上游 Cursor key（crsr_）永远不能当作调用者凭据：否则任何人拿到某把 key 都能绕过网关，
    // 反过来也意味着网关会把调用者提交的 crsr_ 当作上游账号使用。
    if (trimmed.startsWith("crsr_")) {
      throw new GatewayError("Invalid or missing gateway API key.", 401, "authentication_error");
    }

    // 没有任何客户端 key 时同样拒绝（不存在"开放模式"）；启动入口会直接拒绝启动。
    throw new GatewayError("Invalid or missing gateway API key.", 401, "authentication_error");
  }

  filterModelsForClient<T extends { id: string }>(
    auth: AuthenticatedClientIdentity,
    models: readonly T[]
  ): T[] {
    if (auth.kind !== "gateway_key" || auth.allowAllModels) {
      return [...models];
    }
    return models.filter((m) => auth.allowedModels.has(normalizeBaseModelId(m.id)));
  }

  assertModelPermitted(auth: AuthenticatedClientIdentity, requestedModel: string): void {
    if (auth.kind !== "gateway_key" || auth.allowAllModels) return;
    const norm = normalizeBaseModelId(requestedModel);
    if (!auth.allowedModels.has(norm)) {
      throw new GatewayError(
        `Gateway key '${auth.keyName}' is not authorized to access model '${norm}'.`,
        403,
        "model_not_allowed_for_key",
        "model"
      );
    }
  }

  tryReserveRequest(keyId: string | undefined): void {
    if (!keyId) return;
    const found = this.keys.find((k) => k.id === keyId);
    if (!found) return;
    if (found.maxRequests !== null && found.stats.requests >= found.maxRequests) {
      throw new GatewayError(
        `Gateway API key '${found.name}' has reached its maximum request limit (${found.stats.requests}/${found.maxRequests}).`,
        429,
        "api_key_quota_exceeded"
      );
    }
    found.stats.requests += 1;
    found.stats.lastUsedAt = new Date().toISOString();
    if (found.maxRequests !== null && found.stats.requests >= found.maxRequests) {
      this.persist();
    } else {
      this.schedulePersist();
    }
  }

  recordUsage(keyId: string | undefined, inputTokens: number, outputTokens: number): void {
    if (!keyId) return;
    const found = this.keys.find((k) => k.id === keyId);
    if (!found) return;
    found.stats.inputTokens += inputTokens;
    found.stats.outputTokens += outputTokens;
    found.stats.lastUsedAt = new Date().toISOString();
    this.schedulePersist();
  }

  flushStatsToDisk(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persist();
  }

  listKeys(): ClientGatewayKeyView[] {
    return this.keys.map((k) => this.toView(k));
  }

  revealKeyToken(id: string): string {
    const entry = this.keys.find((k) => k.id === id);
    if (!entry) throw new GatewayError(`Gateway key '${id}' not found.`, 404, "not_found");
    return entry.token;
  }

  createKey(params: {
    name: string;
    customToken?: string;
    enabled?: boolean;
    allowAllModels?: boolean;
    allowedModels?: readonly string[];
    maxRequests?: unknown;
    maxConcurrent?: unknown;
    expiresAt?: unknown;
  }): { view: ClientGatewayKeyView; rawToken: string } {
    const name = params.name.trim() || "新建子密钥";
    const token = params.customToken?.trim() || `sk-cgw-${crypto.randomBytes(18).toString("hex")}`;
    if (token.length < 6) {
      throw new GatewayError("自定义网关密钥长度至少需 6 位。", 400, "invalid_request_error");
    }
    if (this.keys.some((k) => k.token === token)) {
      throw new GatewayError("该网关密钥 Token 已存在，请勿重复创建。", 400, "duplicate_token");
    }

    const allowAllModels = params.allowAllModels !== false;
    const allowedSet = new Set(
      (params.allowedModels ?? []).map((m) => normalizeBaseModelId(m)).filter(Boolean)
    );
    if (!allowAllModels && allowedSet.size === 0) {
      throw new GatewayError("指定模型白名单模式下，请至少勾选 1 个允许访问的模型。", 400, "empty_model_allowlist");
    }

    const entry: InternalClientKey = {
      id: `gk_${crypto.randomBytes(8).toString("hex")}`,
      name,
      token,
      enabled: params.enabled !== false,
      allowAllModels,
      allowedModels: allowedSet,
      maxRequests: normalizeMaxRequests(params.maxRequests),
      maxConcurrent: normalizeMaxRequests(params.maxConcurrent),
      expiresAt: normalizeExpiresAt(params.expiresAt),
      createdAt: new Date().toISOString(),
      stats: { requests: 0, inputTokens: 0, outputTokens: 0 }
    };

    this.keys.push(entry);
    this.persist();
    return { view: this.toView(entry), rawToken: entry.token };
  }

  updateKey(
    id: string,
    patch: {
      name?: string;
      enabled?: boolean;
      allowAllModels?: boolean;
      allowedModels?: readonly string[];
      maxRequests?: unknown;
      maxConcurrent?: unknown;
      expiresAt?: unknown;
      resetRequests?: boolean;
    }
  ): ClientGatewayKeyView {
    const entry = this.keys.find((k) => k.id === id);
    if (!entry) throw new GatewayError(`Gateway key '${id}' not found.`, 404, "not_found");

    if (typeof patch.name === "string" && patch.name.trim()) {
      entry.name = patch.name.trim();
    }
    if (typeof patch.enabled === "boolean") {
      entry.enabled = patch.enabled;
    }
    if (typeof patch.allowAllModels === "boolean") {
      entry.allowAllModels = patch.allowAllModels;
    }
    if (Array.isArray(patch.allowedModels)) {
      entry.allowedModels = new Set(patch.allowedModels.map((m) => normalizeBaseModelId(m)).filter(Boolean));
    }
    if (patch.maxRequests !== undefined) {
      entry.maxRequests = normalizeMaxRequests(patch.maxRequests);
    }
    if (patch.maxConcurrent !== undefined) {
      entry.maxConcurrent = normalizeMaxRequests(patch.maxConcurrent);
    }
    if (patch.expiresAt !== undefined) {
      entry.expiresAt = normalizeExpiresAt(patch.expiresAt);
    }
    if (patch.resetRequests === true) {
      entry.stats.requests = 0;
    }
    if (!entry.allowAllModels && entry.allowedModels.size === 0) {
      throw new GatewayError("指定模型白名单模式下，请至少勾选 1 个允许访问的模型。", 400, "empty_model_allowlist");
    }

    this.persist();
    return this.toView(entry);
  }

  deleteKey(id: string): void {
    const idx = this.keys.findIndex((k) => k.id === id);
    if (idx < 0) throw new GatewayError(`Gateway key '${id}' not found.`, 404, "not_found");
    this.keys.splice(idx, 1);
    this.persist();
  }

  private toView(k: InternalClientKey): ClientGatewayKeyView {
    const now = Date.now();
    const isExpired = k.expiresAt !== null && now >= Date.parse(k.expiresAt);
    const isQuotaExhausted = k.maxRequests !== null && k.stats.requests >= k.maxRequests;
    return {
      id: k.id,
      name: k.name,
      maskedToken: maskGatewayToken(k.token),
      enabled: k.enabled,
      allowAllModels: k.allowAllModels,
      allowedModels: [...k.allowedModels].sort(),
      maxRequests: k.maxRequests,
      maxConcurrent: k.maxConcurrent,
      expiresAt: k.expiresAt,
      isExpired,
      isQuotaExhausted,
      createdAt: k.createdAt,
      stats: { ...k.stats }
    };
  }
}
