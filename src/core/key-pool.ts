import crypto from "node:crypto";
import type { BotQuotaView, CursorPlanQuotaView } from "../services/quota-service.js";
import { evictQuotaCachesForKey } from "../services/quota-service.js";
import { normalizeBaseModelId, redactSecrets } from "../utils/hash.js";
import { persistPoolConfigToEnvFile } from "./config.js";
import { SessionAffinityTable, type AffinityBindingView } from "./session-affinity.js";
import { GatewayError, type AutoDisabledState, type GatewayConfig, type LbStrategy } from "./types.js";

export interface KeyIdentitySummary {
  apiKeyName: string;
  userEmail?: string;
  userId?: number;
  createdAt: string;
}

export interface KeySlotStatus {
  slotId: string;
  label?: string;
  maskedKey: string;
  enabled: boolean;
  healthy: boolean;
  autoDisabledReason?: string;
  autoDisabledKind?: "quota" | "auth";
  /** ISO time the gateway expects to re-enable this key by itself (quota trips only). */
  autoRecoverAt?: string;
  apiPoolExhausted: boolean;
  autoPoolExhausted: boolean;
  activeInflight: number;
  stickySessions: number;
  cooldownRemainingMs: number;
  totalSelected: number;
  affinityHits: number;
  rateLimitHits: number;
  quotaExhaustedHits: number;
  authErrors: number;
  identity?: KeyIdentitySummary;
  quota?: CursorPlanQuotaView;
  bot?: BotQuotaView;
  quotaUpdatedAt?: string;
}

interface InternalKeySlot {
  slotId: string;
  label?: string;
  rawKey: string;
  maskedKey: string;
  enabled: boolean;
  autoDisabledReason?: string;
  autoDisabledKind?: "quota" | "auth";
  autoResetAtMs?: number;
  apiPoolExhausted: boolean;
  autoPoolExhausted: boolean;
  activeInflight: number;
  cooldownUntil: number;
  consecutiveRateLimits: number;
  selected: number;
  affinityHits: number;
  rateLimits: number;
  quotaExhaustedHits: number;
  authErrors: number;
  identity?: KeyIdentitySummary;
  quota?: CursorPlanQuotaView;
  bot?: BotQuotaView;
  quotaUpdatedAt?: string;
}

export interface KeyLease {
  apiKey: string;
  slotId: string;
  maskedKey: string;
  label?: string;
  viaAffinity: boolean;
  markSuccess: () => void;
  release: () => void;
}

export interface PoolRoutingSettings {
  lbStrategy: LbStrategy;
  sessionAffinityEnabled: boolean;
  sessionAffinityTtlSeconds: number;
  autoDisableExhaustedKeys: boolean;
  allowNativeWebTools?: boolean;
}

export function maskSecretKey(key: string): string {
  if (key.length <= 12) return "***";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

export function computeKeySlotId(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 10);
}

export function classifyModelQuotaPool(requestedModel: string): "auto" | "api" {
  const base = normalizeBaseModelId(requestedModel || "auto");
  if (
    !base ||
    base === "auto" ||
    base === "auto-smart" ||
    base === "default" ||
    base.startsWith("composer") ||
    base.startsWith("grok") ||
    base.startsWith("cursor")
  ) {
    return "auto";
  }
  return "api";
}

/**
 * Detect whether an upstream SDK / HTTP error means the account has run out of quota/money
 * (as opposed to a transient per-minute concurrency burst).
 */
export function isQuotaOrBillingExhaustedError(err: GatewayError): boolean {
  if (err.status === 402) return true;
  const hay = `${err.code} ${err.message}`.toLowerCase();
  return (
    hay.includes("insufficient_quota") ||
    hay.includes("out of credits") ||
    hay.includes("usage limit") ||
    hay.includes("spend limit") ||
    hay.includes("monthly limit") ||
    hay.includes("included usage") ||
    hay.includes("billing limit") ||
    hay.includes("payment required") ||
    hay.includes("plan limit")
  );
}

function getRemainingPercentForPool(quota: CursorPlanQuotaView | undefined, pool: "auto" | "api"): number | null {
  if (!quota) return null;
  const target = pool === "auto"
    ? quota.cursorModelsAutoPool.remainingPercent
    : quota.premiumApiPool.remainingPercent;
  if (target !== null) return target;
  return quota.overallIncludedPlan.remainingPercent;
}

export class UpstreamKeyPool {
  private readonly slots: InternalKeySlot[] = [];
  private readonly baseCooldownMs: number;
  private readonly envFilePath?: string;
  readonly affinityTable = new SessionAffinityTable();

  private lbStrategy: LbStrategy;
  private sessionAffinityEnabled: boolean;
  private sessionAffinityTtlMs: number;
  private autoDisableExhaustedKeys: boolean;
  private allowNativeWebTools: boolean;
  private rrCursor = 0;

  constructor(config: Pick<
    GatewayConfig,
    | "cursorApiKeys"
    | "disabledCursorApiKeys"
    | "keyLabels"
    | "keyAutoDisabled"
    | "keyCooldownMs"
    | "lbStrategy"
    | "sessionAffinityEnabled"
    | "sessionAffinityTtlMs"
    | "autoDisableExhaustedKeys"
    | "allowNativeWebTools"
    | "envFilePath"
  >) {
    this.baseCooldownMs = config.keyCooldownMs;
    this.lbStrategy = config.lbStrategy;
    this.sessionAffinityEnabled = config.sessionAffinityEnabled;
    this.sessionAffinityTtlMs = config.sessionAffinityTtlMs;
    this.autoDisableExhaustedKeys = config.autoDisableExhaustedKeys;
    this.allowNativeWebTools = config.allowNativeWebTools === true;
    this.envFilePath = config.envFilePath;

    for (const k of config.cursorApiKeys) {
      const s = this.upsertInternal(k, true);
      if (config.keyLabels[s.slotId]) s.label = config.keyLabels[s.slotId];
    }
    for (const k of config.disabledCursorApiKeys) {
      if (!this.slots.some((s) => s.rawKey === k)) {
        const s = this.upsertInternal(k, false);
        if (config.keyLabels[s.slotId]) s.label = config.keyLabels[s.slotId];
        const saved = config.keyAutoDisabled?.[s.slotId];
        if (saved) {
          s.autoDisabledKind = saved.kind;
          s.autoDisabledReason = saved.reason || undefined;
          if (saved.resetAtMs) s.autoResetAtMs = saved.resetAtMs;
        }
      }
    }
  }

  private upsertInternal(rawKey: string, enabled: boolean, label?: string): InternalKeySlot {
    const trimmed = rawKey.trim();
    const existing = this.slots.find((s) => s.rawKey === trimmed);
    if (existing) {
      existing.enabled = enabled;
      if (enabled) {
        existing.autoDisabledReason = undefined;
        existing.autoDisabledKind = undefined;
      }
      if (label !== undefined) existing.label = label.trim() || undefined;
      return existing;
    }
    const slot: InternalKeySlot = {
      slotId: computeKeySlotId(trimmed),
      ...(label?.trim() ? { label: label.trim() } : {}),
      rawKey: trimmed,
      maskedKey: maskSecretKey(trimmed),
      enabled,
      apiPoolExhausted: false,
      autoPoolExhausted: false,
      activeInflight: 0,
      cooldownUntil: 0,
      consecutiveRateLimits: 0,
      selected: 0,
      affinityHits: 0,
      rateLimits: 0,
      quotaExhaustedHits: 0,
      authErrors: 0
    };
    this.slots.push(slot);
    return slot;
  }

  private persist(): void {
    const keyLabels: Record<string, string> = {};
    for (const s of this.slots) {
      if (s.label) keyLabels[s.slotId] = s.label;
    }
    const keyAutoDisabled: Record<string, AutoDisabledState> = {};
    for (const s of this.slots) {
      if (!s.enabled && s.autoDisabledKind && s.autoDisabledReason) {
        keyAutoDisabled[s.slotId] = {
          kind: s.autoDisabledKind,
          reason: s.autoDisabledReason,
          ...(s.autoResetAtMs ? { resetAtMs: s.autoResetAtMs } : {})
        };
      }
    }
    persistPoolConfigToEnvFile(this.envFilePath, {
      activeKeys: this.slots.filter((s) => s.enabled).map((s) => s.rawKey),
      disabledKeys: this.slots.filter((s) => !s.enabled).map((s) => s.rawKey),
      keyLabels,
      keyAutoDisabled,
      lbStrategy: this.lbStrategy,
      sessionAffinityEnabled: this.sessionAffinityEnabled,
      sessionAffinityTtlMs: this.sessionAffinityTtlMs,
      autoDisableExhaustedKeys: this.autoDisableExhaustedKeys,
      allowNativeWebTools: this.allowNativeWebTools
    });
  }

  getSettings(): PoolRoutingSettings {
    return {
      lbStrategy: this.lbStrategy,
      sessionAffinityEnabled: this.sessionAffinityEnabled,
      sessionAffinityTtlSeconds: Math.round(this.sessionAffinityTtlMs / 1000),
      autoDisableExhaustedKeys: this.autoDisableExhaustedKeys,
      allowNativeWebTools: this.allowNativeWebTools
    };
  }

  updateSettings(patch: Partial<PoolRoutingSettings>): void {
    if (patch.lbStrategy) this.lbStrategy = patch.lbStrategy;
    if (typeof patch.sessionAffinityEnabled === "boolean") {
      this.sessionAffinityEnabled = patch.sessionAffinityEnabled;
      if (!patch.sessionAffinityEnabled) this.affinityTable.clearAll();
    }
    if (typeof patch.sessionAffinityTtlSeconds === "number" && patch.sessionAffinityTtlSeconds >= 10) {
      this.sessionAffinityTtlMs = patch.sessionAffinityTtlSeconds * 1000;
    }
    if (typeof patch.autoDisableExhaustedKeys === "boolean") {
      this.autoDisableExhaustedKeys = patch.autoDisableExhaustedKeys;
    }
    if (typeof patch.allowNativeWebTools === "boolean") {
      this.allowNativeWebTools = patch.allowNativeWebTools;
    }
    this.persist();
  }

  allManagedKeys(): Array<{ slotId: string; rawKey: string; enabled: boolean }> {
    this.reviveCycleResetAccounts();
    return this.slots.map((s) => ({ slotId: s.slotId, rawKey: s.rawKey, enabled: s.enabled }));
  }

  enabledKeyCount(): number {
    this.reviveCycleResetAccounts();
    return this.slots.filter((s) => s.enabled).length;
  }

  private reviveCycleResetAccounts(): void {
    const now = Date.now();
    let changed = false;
    for (const s of this.slots) {
      // Only quota trips self-heal on the billing reset; an auth failure needs an explicit re-check.
      if (!s.enabled && s.autoDisabledReason && s.autoDisabledKind === "quota" && s.autoResetAtMs && now >= s.autoResetAtMs) {
        s.enabled = true;
        s.autoDisabledReason = undefined;
        s.autoDisabledKind = undefined;
        s.autoResetAtMs = undefined;
        s.apiPoolExhausted = false;
        s.autoPoolExhausted = false;
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private isSlotEligibleForPool(slot: InternalKeySlot, targetPool: "auto" | "api", now: number): boolean {
    if (!slot.enabled) return false;
    if (slot.cooldownUntil > now) return false;
    if (targetPool === "auto" && slot.autoPoolExhausted && !slot.quota?.onDemandSpend.enabled) return false;
    if (targetPool === "api" && slot.apiPoolExhausted && !slot.quota?.onDemandSpend.enabled) return false;
    return true;
  }

  isKeyUsable(rawKey: string, requestedModel = "auto"): boolean {
    this.reviveCycleResetAccounts();
    const slot = this.slots.find((s) => s.rawKey === rawKey);
    if (!slot) return true;
    const pool = classifyModelQuotaPool(requestedModel);
    return this.isSlotEligibleForPool(slot, pool, Date.now());
  }

  leaseSpecificKey(rawKey: string, viaAffinity = false): KeyLease {
    const slot = this.slots.find((s) => s.rawKey === rawKey);
    if (slot) {
      slot.selected += 1;
      if (viaAffinity) slot.affinityHits += 1;
      slot.activeInflight += 1;
    }
    let released = false;
    return {
      apiKey: rawKey,
      slotId: slot?.slotId ?? "direct",
      maskedKey: slot?.maskedKey ?? maskSecretKey(rawKey),
      ...(slot?.label ? { label: slot.label } : {}),
      viaAffinity,
      markSuccess: () => {
        if (slot) slot.consecutiveRateLimits = 0;
      },
      release: () => {
        if (released) return;
        released = true;
        if (slot && slot.activeInflight > 0) slot.activeInflight -= 1;
      }
    };
  }

  /**
   * Read-only pick of one enabled upstream key for catalog lookups (`/v1/models`, admin model list).
   * Unlike `leaseKey` it does not count as a selection, bind affinity, occupy a concurrency slot,
   * or fail with a quota error just because the pool is busy.
   */
  peekKeyForCatalog(): string {
    this.reviveCycleResetAccounts();
    const slot = this.slots.find((x) => x.enabled);
    if (!slot) {
      throw new GatewayError("No enabled upstream Cursor API keys available.", 503, "no_enabled_keys");
    }
    return slot.rawKey;
  }

  /**
   * Lease an optimal upstream Cursor API key after client authentication has already succeeded.
   * Always selects from the managed pool (1h sticky affinity); caller tokens are never used upstream.
   */
  leaseKey(
    requestedModel = "auto",
    excludeKeys?: ReadonlySet<string>,
    conversationKey?: string
  ): KeyLease {
    this.reviveCycleResetAccounts();

    // 调用者令牌绝不能作为上游 key 使用，上游账号只能从受管池里选。
    if (this.slots.length === 0) {
      throw new GatewayError("All upstream Cursor accounts are currently disabled or unconfigured.", 503, "no_enabled_keys");
    }
    return this.pickFromPool(requestedModel, excludeKeys, conversationKey);
  }

  private pickFromPool(
    requestedModel: string,
    excludeKeys?: ReadonlySet<string>,
    conversationKey?: string
  ): KeyLease {
    const now = Date.now();
    const targetPool = classifyModelQuotaPool(requestedModel);

    // Clear expired cooldowns
    for (const s of this.slots) {
      if (s.cooldownUntil > 0 && s.cooldownUntil <= now) s.cooldownUntil = 0;
    }

    // Step 1: Check CPA-style Sticky Session Affinity first!
    if (this.sessionAffinityEnabled && conversationKey) {
      const stickyRawKey = this.affinityTable.lookup(conversationKey, this.sessionAffinityTtlMs);
      if (stickyRawKey && !excludeKeys?.has(stickyRawKey)) {
        const stickySlot = this.slots.find((s) => s.rawKey === stickyRawKey);
        if (stickySlot && this.isSlotEligibleForPool(stickySlot, targetPool, now)) {
          return this.leaseSpecificKey(stickySlot.rawKey, true);
        }
        // Bound account is exhausted, cooling down, or disabled -> break affinity so we rebind cleanly to B!
        this.affinityTable.evictConversation(conversationKey);
      }
    }

    const enabledSlots = this.slots.filter((s) => s.enabled && !excludeKeys?.has(s.rawKey));
    if (enabledSlots.length === 0) {
      throw new GatewayError("No enabled upstream Cursor API keys available.", 503, "no_enabled_keys");
    }

    let candidates = enabledSlots.filter((s) => s.cooldownUntil === 0);
    // All enabled accounts in transient 429 cooldown -> still run the exhaustion check below,
    // then pick the one whose cooldown expires soonest.
    const allCoolingDown = candidates.length === 0;
    if (allCoolingDown) {
      candidates = [...enabledSlots].sort((a, b) => a.cooldownUntil - b.cooldownUntil);
    }

    // Filter out accounts whose target pool is exhausted without allowed fallback
    const nonExhausted = candidates.filter((s) => {
      const flagged = targetPool === "auto" ? s.autoPoolExhausted : s.apiPoolExhausted;
      if (flagged && !s.quota?.onDemandSpend.enabled) return false;
      return true;
    });
    if (nonExhausted.length > 0) {
      candidates = nonExhausted;
    } else if (!candidates.some((s) => s.quota?.onDemandSpend.enabled)) {
      throw new GatewayError(
        `All enabled Cursor accounts have exhausted their '${targetPool}' quota.`,
        429,
        "quota_exhausted"
      );
    }

    if (allCoolingDown) {
      return this.bindAndLease(candidates[0]!, conversationKey);
    }

    if (this.lbStrategy === "round-robin") {
      const picked = this.nextRoundRobin(candidates);
      return this.bindAndLease(picked, conversationKey);
    }

    if (this.lbStrategy === "quota-aware") {
      const withIncluded = candidates.filter((s) => {
        const rem = getRemainingPercentForPool(s.quota, targetPool);
        const flagged = targetPool === "auto" ? s.autoPoolExhausted : s.apiPoolExhausted;
        return !flagged && (rem === null || rem > 0);
      });
      if (withIncluded.length > 0) candidates = withIncluded;
    }

    const n = this.slots.length;
    const startCursor = this.rrCursor;
    this.rrCursor = (this.rrCursor + 1) % Math.max(1, n);

    candidates.sort((a, b) => {
      if (a.activeInflight !== b.activeInflight) return a.activeInflight - b.activeInflight;
      if (this.lbStrategy === "quota-aware") {
        const remA = getRemainingPercentForPool(a.quota, targetPool);
        const remB = getRemainingPercentForPool(b.quota, targetPool);
        const bandA = remA !== null ? Math.floor(remA / 15) : 7;
        const bandB = remB !== null ? Math.floor(remB / 15) : 7;
        if (bandA !== bandB) return bandB - bandA;
      }
      const idxA = (this.slots.indexOf(a) - startCursor + n) % n;
      const idxB = (this.slots.indexOf(b) - startCursor + n) % n;
      return idxA - idxB;
    });

    return this.bindAndLease(candidates[0]!, conversationKey);
  }

  private bindAndLease(slot: InternalKeySlot, conversationKey?: string): KeyLease {
    if (this.sessionAffinityEnabled && conversationKey) {
      this.affinityTable.bind({
        conversationKey,
        rawKey: slot.rawKey,
        slotId: slot.slotId,
        maskedKey: slot.maskedKey,
        ttlMs: this.sessionAffinityTtlMs
      });
    }
    return this.leaseSpecificKey(slot.rawKey, false);
  }

  private nextRoundRobin(candidates: InternalKeySlot[]): InternalKeySlot {
    const n = this.slots.length;
    for (let offset = 0; offset < n; offset += 1) {
      const slot = this.slots[(this.rrCursor + offset) % n]!;
      if (candidates.includes(slot)) {
        this.rrCursor = (this.rrCursor + offset + 1) % n;
        return slot;
      }
    }
    return candidates[0]!;
  }

  /**
   * CPA-style exponential backoff cooldown for transient 429 burst errors (30s -> 60s -> 120s -> max 300s).
   */
  reportRateLimit(rawKey: string): void {
    const slot = this.slots.find((s) => s.rawKey === rawKey);
    if (!slot) return;
    slot.rateLimits += 1;
    slot.consecutiveRateLimits += 1;
    const multiplier = Math.min(10, 2 ** (slot.consecutiveRateLimits - 1));
    const backoffMs = Math.min(300_000, this.baseCooldownMs * multiplier);
    slot.cooldownUntil = Date.now() + backoffMs;
    this.affinityTable.evictAllForKey(rawKey);
  }

  /**
   * Circuit breaker when an account runs out of money/quota mid-flight!
   * Evicts sticky sessions from Account A so they seamlessly rebind to Account B,
   * marks the affected pool exhausted, and auto-disables Account A if configured!
   */
  reportQuotaExhausted(rawKey: string, requestedModel: string, reasonDetail?: string): void {
    const slot = this.slots.find((s) => s.rawKey === rawKey);
    if (!slot) return;
    slot.quotaExhaustedHits += 1;
    this.affinityTable.evictAllForKey(rawKey);

    const pool = classifyModelQuotaPool(requestedModel);
    if (pool === "auto") {
      slot.autoPoolExhausted = true;
    } else {
      slot.apiPoolExhausted = true;
    }

    if (this.autoDisableExhaustedKeys) {
      // If Auto pool failed (meaning core Cursor/Grok quota is dead), or both pools are exhausted,
      // or we have no quota telemetry proving the other pool still has balance -> disable account!
      const autoStillHasBalance = pool === "api"
        && !slot.autoPoolExhausted
        && (slot.quota?.cursorModelsAutoPool.remainingPercent ?? 0) > 0;

      if (!autoStillHasBalance) {
        slot.enabled = false;
        slot.autoDisabledKind = "quota";
        slot.autoDisabledReason = reasonDetail
          ? `额度耗尽自动熔断: ${redactSecrets(reasonDetail).slice(0, 60)}`
          : "额度耗尽自动熔断 (Quota Exhausted)";
        this.persist();
      }
    }
  }

  reportAuthFailure(rawKey: string, reasonDetail?: string): void {
    const slot = this.slots.find((s) => s.rawKey === rawKey);
    if (!slot) return;
    slot.authErrors += 1;
    this.affinityTable.evictAllForKey(rawKey);

    if (this.autoDisableExhaustedKeys) {
      slot.enabled = false;
      slot.autoDisabledKind = "auth";
      slot.autoDisabledReason = reasonDetail
        ? `鉴权失效自动关停: ${redactSecrets(reasonDetail).slice(0, 60)}`
        : "鉴权失效自动关停 (401 Unauthorized)";
      this.persist();
    } else {
      slot.cooldownUntil = Date.now() + this.baseCooldownMs * 10;
    }
  }

  /**
   * Update live quota telemetry from `/auth/usage-summary` and proactively trip/reset exhaustion flags!
   */
  updateSlotQuotaCache(rawKey: string, identity?: KeyIdentitySummary, quota?: CursorPlanQuotaView, bot?: BotQuotaView): void {
    const slot = this.slots.find((s) => s.rawKey === rawKey);
    if (!slot) return;
    if (identity) slot.identity = identity;
    if (bot) slot.bot = bot;
    if (!quota) return;

    slot.quota = quota;
    slot.quotaUpdatedAt = new Date().toISOString();

    if (quota.billingCycleEnd) {
      const endMs = Date.parse(quota.billingCycleEnd);
      if (Number.isFinite(endMs)) slot.autoResetAtMs = endMs;
    }

    const autoRem = quota.cursorModelsAutoPool.remainingPercent;
    const apiRem = quota.premiumApiPool.remainingPercent;

    slot.autoPoolExhausted = autoRem !== null && autoRem <= 0;
    slot.apiPoolExhausted = apiRem !== null && apiRem <= 0;

    // Proactive auto-disable if BOTH pools are 0% and On-Demand is off (nothing left to spend).
    if (
      this.autoDisableExhaustedKeys &&
      slot.enabled &&
      slot.autoPoolExhausted &&
      slot.apiPoolExhausted &&
      !quota.onDemandSpend.enabled
    ) {
      slot.enabled = false;
      slot.autoDisabledKind = "quota";
      slot.autoDisabledReason = "Auto 与 API 双池套餐额度均已归零 (0%)，已自动熔断关停";
      this.affinityTable.evictAllForKey(rawKey);
      this.persist();
      return;
    }

    // Recovery: a quota-tripped key that fresh telemetry shows is usable again (top-up, plan upgrade,
    // on-demand switched on, new cycle) is re-enabled without waiting for the billing reset.
    if (!slot.enabled && slot.autoDisabledKind === "quota") {
      // Conservative on purpose: both pools must have room (or overage on) so the key does not flap.
      const usable = (!slot.autoPoolExhausted && !slot.apiPoolExhausted) || quota.onDemandSpend.enabled;
      if (usable) {
        slot.enabled = true;
        slot.autoDisabledReason = undefined;
        slot.autoDisabledKind = undefined;
        slot.cooldownUntil = 0;
        slot.consecutiveRateLimits = 0;
        this.persist();
        return;
      }
    }
    if (!slot.enabled && slot.autoDisabledKind === "quota") this.persist();
  }

  /** Quota-tripped keys that should be probed for recovery (disabled by the gateway, not by a person). */
  recoveryProbeKeys(): string[] {
    return this.slots.filter((s) => !s.enabled && s.autoDisabledKind === "quota").map((s) => s.rawKey);
  }

  /** Clear an automatic trip so the key is used again; the next request or sync re-trips it if still bad. */
  recheckSlot(slotId: string): void {
    const slot = this.slots.find((s) => s.slotId === slotId);
    if (!slot) throw new GatewayError(`Key slot '${slotId}' not found.`, 404, "not_found");
    if (!slot.enabled && slot.autoDisabledKind) {
      slot.enabled = true;
      slot.autoDisabledReason = undefined;
      slot.autoDisabledKind = undefined;
      slot.autoResetAtMs = undefined;
      slot.apiPoolExhausted = false;
      slot.autoPoolExhausted = false;
      slot.cooldownUntil = 0;
      slot.consecutiveRateLimits = 0;
      this.persist();
    }
  }

  addKey(rawKey: string, enabled = true, label?: string): KeySlotStatus {
    const trimmed = rawKey.trim();
    if (!/^crsr_[A-Za-z0-9_-]{15,200}$/.test(trimmed)) {
      throw new GatewayError("Cursor API key must start with `crsr_`.", 400, "invalid_api_key");
    }
    const slot = this.upsertInternal(trimmed, enabled, label);
    this.persist();
    return this.toSlotStatus(slot, this.affinityTable.countBySlot());
  }

  updateSlotMeta(
    slotId: string,
    patch: { enabled?: boolean; label?: string; clearCooldown?: boolean }
  ): KeySlotStatus {
    const slot = this.slots.find((s) => s.slotId === slotId);
    if (!slot) throw new GatewayError(`Key slot '${slotId}' not found.`, 404, "not_found");

    if (patch.clearCooldown) {
      slot.cooldownUntil = 0;
      slot.consecutiveRateLimits = 0;
    }
    if (patch.label !== undefined) {
      slot.label = patch.label.trim() || undefined;
    }
    if (typeof patch.enabled === "boolean") {
      slot.enabled = patch.enabled;
      if (patch.enabled) {
        slot.cooldownUntil = 0;
        slot.consecutiveRateLimits = 0;
        slot.autoDisabledReason = undefined;
        slot.autoDisabledKind = undefined;
      } else {
        slot.autoDisabledReason = undefined;
        slot.autoDisabledKind = undefined;
        this.affinityTable.evictAllForKey(slot.rawKey);
      }
    }
    this.persist();
    return this.toSlotStatus(slot, this.affinityTable.countBySlot());
  }

  removeKey(slotId: string): void {
    const idx = this.slots.findIndex((s) => s.slotId === slotId);
    if (idx < 0) throw new GatewayError(`Key slot '${slotId}' not found.`, 404, "not_found");
    const [removed] = this.slots.splice(idx, 1);
    if (removed) {
      this.affinityTable.evictAllForKey(removed.rawKey);
      evictQuotaCachesForKey(removed.rawKey);
    }
    this.persist();
  }

  affinitySnapshot(limit = 50): AffinityBindingView[] {
    return this.affinityTable.snapshot(limit);
  }

  clearAffinity(): void {
    this.affinityTable.clearAll();
  }

  private toSlotStatus(slot: InternalKeySlot, stickyCounts: Map<string, number>): KeySlotStatus {
    const rem = Math.max(0, slot.cooldownUntil - Date.now());
    return {
      slotId: slot.slotId,
      ...(slot.label ? { label: slot.label } : {}),
      maskedKey: slot.maskedKey,
      enabled: slot.enabled,
      healthy: slot.enabled && rem === 0 && !slot.autoPoolExhausted,
      ...(slot.autoDisabledReason ? { autoDisabledReason: slot.autoDisabledReason } : {}),
      ...(slot.autoDisabledKind && !slot.enabled ? { autoDisabledKind: slot.autoDisabledKind } : {}),
      ...(slot.autoDisabledKind === "quota" && !slot.enabled && slot.autoResetAtMs ? { autoRecoverAt: new Date(slot.autoResetAtMs).toISOString() } : {}),
      apiPoolExhausted: slot.apiPoolExhausted,
      autoPoolExhausted: slot.autoPoolExhausted,
      activeInflight: slot.activeInflight,
      stickySessions: stickyCounts.get(slot.slotId) ?? 0,
      cooldownRemainingMs: rem,
      totalSelected: slot.selected,
      affinityHits: slot.affinityHits,
      rateLimitHits: slot.rateLimits,
      quotaExhaustedHits: slot.quotaExhaustedHits,
      authErrors: slot.authErrors,
      ...(slot.identity ? { identity: slot.identity } : {}),
      ...(slot.quota ? { quota: slot.quota } : {}),
      ...(slot.bot ? { bot: slot.bot } : {}),
      ...(slot.quotaUpdatedAt ? { quotaUpdatedAt: slot.quotaUpdatedAt } : {})
    };
  }

  statusSnapshot(): KeySlotStatus[] {
    this.reviveCycleResetAccounts();
    const stickyCounts = this.affinityTable.countBySlot();
    return this.slots.map((s) => this.toSlotStatus(s, stickyCounts));
  }
}
