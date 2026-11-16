import { Cursor } from "@cursor/sdk";
import { maskSecretKey } from "../core/key-pool.js";

export interface CursorPlanQuotaView {
  membershipType: string;
  billingCycleStart?: string;
  billingCycleEnd?: string;
  daysRemainingInCycle?: number;
  autoDisplayMessage?: string;
  apiDisplayMessage?: string;
  /** Cursor Models pool (Auto + Composer + Cursor Grok) */
  cursorModelsAutoPool: {
    usedPercent: number | null;
    remainingPercent: number | null;
  };
  /** Other / Named API Models pool (Claude, Gemini, GPT, etc.) */
  premiumApiPool: {
    usedPercent: number | null;
    remainingPercent: number | null;
  };
  /** Overall plan allowance & bonus breakdown in USD */
  overallIncludedPlan: {
    usedPercent: number | null;
    remainingPercent: number | null;
    allowanceUsd: number | null;
    breakdownUsd?: {
      includedUsd: number;
      bonusUsd: number;
      totalUsd: number;
    };
  };
  onDemandSpend: {
    enabled: boolean;
    usedUsd: number;
    limitUsd: number | null;
    remainingUsd: number | null;
  };
}

/** Cursor "Bot" (Grok Bot / sand) included-usage pool, from `DashboardService/GetSandUsageStatus`. */
export interface BotQuotaView {
  /** False when the plan has no included Bot allowance (the pool then shows as unavailable). */
  hasLimit: boolean;
  usedPercent: number | null;
  remainingPercent: number | null;
  hasAvailableUsage: boolean;
  periodStart?: string;
  /** Next reset, ISO string, when upstream reports one. */
  resetAt?: string;
}

export interface AccountQuotaReport {
  maskedKey: string;
  status: "ok" | "error";
  bot?: BotQuotaView;
  identity?: {
    apiKeyName: string;
    userEmail?: string;
    userId?: number;
    createdAt: string;
  };
  quota?: CursorPlanQuotaView;
  error?: string;
}

interface CachedAccessToken {
  accessToken: string;
  expiresAtMs: number;
}

const CURSOR_API2_BASE = "https://api2.cursor.sh";
const SUMMARY_CACHE_TTL_MS = 60_000; // 60s anti-burst cache for usage-summary
const exchangedTokenCache = new Map<string, CachedAccessToken>();
const inflightTokenExchange = new Map<string, Promise<string>>();
const summaryCache = new Map<string, { report: AccountQuotaReport; expiresAtMs: number }>();
const identityCache = new Map<
  string,
  { apiKeyName: string; userEmail?: string; userId?: number; createdAt: string }
>();

export function evictQuotaCachesForKey(cursorApiKey: string): void {
  exchangedTokenCache.delete(cursorApiKey);
  summaryCache.delete(cursorApiKey);
  identityCache.delete(cursorApiKey);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clampPercent(p: number | null): number | null {
  if (p === null) return null;
  return Number(Math.min(100, Math.max(0, p)).toFixed(2));
}

function decodeJwtExpMs(jwt: string): number {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return Date.now() + 10 * 60 * 1000;
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.exp === "number") {
      // Refresh 60s before actual JWT expiry
      return payload.exp * 1000 - 60_000;
    }
  } catch {
    // Fallback TTL
  }
  return Date.now() + 10 * 60 * 1000;
}

/**
 * Exchange a `crsr_...` User API Key for a short-lived Cursor Bearer `accessToken` JWT
 * via `POST https://api2.cursor.sh/auth/exchange_user_api_key`, with automatic expiry caching.
 */
export async function exchangeApiKeyForAccessToken(
  apiKey: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const now = Date.now();
  const cached = exchangedTokenCache.get(apiKey);
  if (cached && cached.expiresAtMs > now) {
    return cached.accessToken;
  }

  const inflight = inflightTokenExchange.get(apiKey);
  if (inflight) return inflight;

  const task = (async () => {
    const resp = await fetcher(`${CURSOR_API2_BASE}/auth/exchange_user_api_key`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });

    if (!resp.ok) {
      const text = (await resp.text().catch(() => "")).slice(0, 200);
      throw new Error(`API key token exchange failed (HTTP ${resp.status}): ${text || resp.statusText}`);
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const token = typeof data.accessToken === "string"
      ? data.accessToken
      : typeof data.token === "string"
        ? data.token
        : "";
    if (!token) {
      throw new Error("Token exchange response did not include accessToken.");
    }

    exchangedTokenCache.set(apiKey, {
      accessToken: token,
      expiresAtMs: decodeJwtExpMs(token)
    });
    return token;
  })().finally(() => {
    inflightTokenExchange.delete(apiKey);
  });

  inflightTokenExchange.set(apiKey, task);
  return task;
}

/**
 * Parse Cursor's `GET https://api2.cursor.sh/auth/usage-summary` payload into a clean dual-pool view.
 */
export function parseCursorUsageSummaryPayload(raw: unknown): CursorPlanQuotaView {
  const data = isRecord(raw) ? raw : {};
  const membershipType = typeof data.membershipType === "string" ? data.membershipType : "unknown";
  const billingCycleStart = typeof data.billingCycleStart === "string" ? data.billingCycleStart : undefined;
  const billingCycleEnd = typeof data.billingCycleEnd === "string" ? data.billingCycleEnd : undefined;
  const autoDisplayMessage = typeof data.autoModelSelectedDisplayMessage === "string"
    ? data.autoModelSelectedDisplayMessage
    : undefined;
  const apiDisplayMessage = typeof data.namedModelSelectedDisplayMessage === "string"
    ? data.namedModelSelectedDisplayMessage
    : undefined;

  let daysRemainingInCycle: number | undefined;
  if (billingCycleEnd) {
    const endMs = Date.parse(billingCycleEnd);
    if (Number.isFinite(endMs)) {
      daysRemainingInCycle = Math.max(0, Number(((endMs - Date.now()) / 86_400_000).toFixed(1)));
    }
  }

  const ind = isRecord(data.individualUsage) ? data.individualUsage : {};
  const plan = isRecord(ind.plan) ? ind.plan : null;
  const overall = isRecord(ind.overall) ? ind.overall : null;
  const onDemand = isRecord(ind.onDemand) ? ind.onDemand : null;

  const autoUsed = clampPercent(numOrNull(plan?.autoPercentUsed));
  const apiUsed = clampPercent(numOrNull(plan?.apiPercentUsed));

  let totalUsed = clampPercent(numOrNull(plan?.totalPercentUsed));
  let allowanceUsd: number | null = null;
  let breakdownUsd: { includedUsd: number; bonusUsd: number; totalUsd: number } | undefined;

  if (plan && typeof plan.limit === "number") {
    allowanceUsd = Number((plan.limit / 100).toFixed(2));
    if (isRecord(plan.breakdown)) {
      const inc = numOrNull(plan.breakdown.included) ?? plan.limit;
      const bon = numOrNull(plan.breakdown.bonus) ?? 0;
      const tot = numOrNull(plan.breakdown.total) ?? inc + bon;
      breakdownUsd = {
        includedUsd: Number((inc / 100).toFixed(2)),
        bonusUsd: Number((bon / 100).toFixed(2)),
        totalUsd: Number((tot / 100).toFixed(2))
      };
    }
  } else if (overall && typeof overall.limit === "number" && overall.limit > 0) {
    allowanceUsd = Number((overall.limit / 100).toFixed(2));
    if (totalUsed === null && typeof overall.used === "number") {
      totalUsed = clampPercent((overall.used / overall.limit) * 100);
    }
  }

  const odEnabled = onDemand?.enabled === true;
  const odUsedCents = numOrNull(onDemand?.used) ?? 0;
  const odLimitCents = numOrNull(onDemand?.limit);
  const odRemCents = numOrNull(onDemand?.remaining);

  return {
    membershipType,
    ...(billingCycleStart ? { billingCycleStart } : {}),
    ...(billingCycleEnd ? { billingCycleEnd } : {}),
    ...(daysRemainingInCycle !== undefined ? { daysRemainingInCycle } : {}),
    ...(autoDisplayMessage ? { autoDisplayMessage } : {}),
    ...(apiDisplayMessage ? { apiDisplayMessage } : {}),
    cursorModelsAutoPool: {
      usedPercent: autoUsed,
      remainingPercent: autoUsed !== null ? Number((100 - autoUsed).toFixed(2)) : null
    },
    premiumApiPool: {
      usedPercent: apiUsed,
      remainingPercent: apiUsed !== null ? Number((100 - apiUsed).toFixed(2)) : null
    },
    overallIncludedPlan: {
      usedPercent: totalUsed,
      remainingPercent: totalUsed !== null ? Number((100 - totalUsed).toFixed(2)) : null,
      allowanceUsd,
      ...(breakdownUsd ? { breakdownUsd } : {})
    },
    onDemandSpend: {
      enabled: odEnabled,
      usedUsd: Number((odUsedCents / 100).toFixed(2)),
      limitUsd: odLimitCents !== null ? Number((odLimitCents / 100).toFixed(2)) : null,
      remainingUsd: odRemCents !== null ? Number((odRemCents / 100).toFixed(2)) : null
    }
  };
}

const DASHBOARD_SERVICE = `${CURSOR_API2_BASE}/aiserver.v1.DashboardService`;

function isoFromAny(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) {
    const asNum = Number(v);
    const ms = Number.isFinite(asNum) && /^\d{10,13}$/.test(v.trim()) ? (v.trim().length <= 10 ? asNum * 1000 : asNum) : Date.parse(v);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v < 1e11 ? v * 1000 : v).toISOString();
  }
  return undefined;
}

/** Parse `GetSandUsageStatus` into the compact Bot pool view. Exported for tests. */
export function parseSandUsageStatus(raw: unknown): BotQuotaView {
  const data = isRecord(raw) ? raw : {};
  const hasLimit = data.hasNonZeroIncludedLimit === true;
  const used = hasLimit ? clampPercent(numOrNull(data.usagePercent)) : null;
  const resetAt = isoFromAny(data.nextResetTimestampUtc);
  const periodStart = isoFromAny(data.currentPeriodStart);
  return {
    hasLimit,
    usedPercent: used,
    remainingPercent: used !== null ? Number((100 - used).toFixed(2)) : null,
    hasAvailableUsage: data.hasAvailableUsage !== false,
    ...(periodStart ? { periodStart } : {}),
    ...(resetAt ? { resetAt } : {})
  };
}

async function dashboardRpc(
  accessToken: string,
  method: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch
): Promise<Record<string, unknown>> {
  const resp = await fetcher(`${DASHBOARD_SERVICE}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    throw new Error(`${method} HTTP ${resp.status}: ${text.slice(0, 160) || resp.statusText}`);
  }
  try {
    const parsed = text ? JSON.parse(text) : {};
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Turn the account's usage-based ("on-demand" / overage) spending on or off.
 * Uses the same Bearer token the gateway already holds; no browser cookie involved.
 * `off` sets a zero cap and forbids usage-based billing; `on` removes the cap (upstream's own "no limit" value).
 * Returns the state read back from `usage-summary` so callers never trust the write blindly.
 */
export async function setOnDemandSpending(
  apiKey: string,
  mode: "on" | "off",
  fetcher: typeof fetch = fetch
): Promise<{ enabled: boolean; usedUsd: number; limitUsd: number | null }> {
  const accessToken = await exchangeApiKeyForAccessToken(apiKey, fetcher);
  const body = mode === "off"
    ? { hardLimit: 0, noUsageBasedAllowed: true }
    : { hardLimit: 2147483647, noUsageBasedAllowed: false };
  await dashboardRpc(accessToken, "SetHardLimit", body, fetcher);
  summaryCache.delete(apiKey);

  const resp = await fetcher(`${CURSOR_API2_BASE}/auth/usage-summary`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  if (!resp.ok) throw new Error(`usage-summary HTTP ${resp.status} after update`);
  const view = parseCursorUsageSummaryPayload(await resp.json());
  const enabled = view.onDemandSpend.enabled;
  if (enabled !== (mode === "on")) {
    throw new Error(`On-demand state did not change (still ${enabled ? "enabled" : "disabled"}).`);
  }
  return { enabled, usedUsd: view.onDemandSpend.usedUsd, limitUsd: view.onDemandSpend.limitUsd };
}

/**
 * Fetch live identity AND full plan quota (Auto remaining %, Premium API remaining %, bonus & on-demand USD)
 * directly from `crsr_...` API keys via `/auth/exchange_user_api_key` -> `/auth/usage-summary`!
 * Zero browser cookies required.
 */
export async function fetchAllAccountQuotas(
  apiKeys: readonly string[],
  options: {
    forceRefresh?: boolean;
    fetcher?: typeof fetch;
    meFetcher?: (apiKey: string) => Promise<{
      apiKeyName: string;
      userEmail?: string;
      userId?: number;
      createdAt: string;
    }>;
  } = {}
): Promise<AccountQuotaReport[]> {
  const fetcher = options.fetcher ?? fetch;
  const meFetcher = options.meFetcher ?? ((k: string) => Cursor.me({ apiKey: k }));

  return Promise.all(
    apiKeys.map(async (apiKey): Promise<AccountQuotaReport> => {
      const maskedKey = maskSecretKey(apiKey);
      const now = Date.now();
      if (!options.forceRefresh) {
        const cachedSummary = summaryCache.get(apiKey);
        if (cachedSummary && cachedSummary.expiresAtMs > now) {
          return cachedSummary.report;
        }
      }
      try {
        const getCachedMe = async () => {
          const hit = identityCache.get(apiKey);
          if (hit) return hit;
          const fetched = await meFetcher(apiKey);
          identityCache.set(apiKey, fetched);
          return fetched;
        };

        const [me, accessToken] = await Promise.all([
          getCachedMe(),
          exchangeApiKeyForAccessToken(apiKey, fetcher)
        ]);

        const usageResp = await fetcher(`${CURSOR_API2_BASE}/auth/usage-summary`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          }
        });

        if (!usageResp.ok) {
          const errText = (await usageResp.text().catch(() => "")).slice(0, 200);
          return {
            maskedKey,
            status: "error",
            identity: {
              apiKeyName: me.apiKeyName,
              userEmail: me.userEmail,
              userId: me.userId,
              createdAt: me.createdAt
            },
            error: `usage-summary HTTP ${usageResp.status}: ${errText}`
          };
        }

        const rawSummary = await usageResp.json();
        // Bot pool is best-effort: a failure must never hide the main quota view.
        const bot = await dashboardRpc(accessToken, "GetSandUsageStatus", {}, fetcher)
          .then(parseSandUsageStatus)
          .catch(() => undefined);
        const report: AccountQuotaReport = {
          maskedKey,
          status: "ok",
          ...(bot ? { bot } : {}),
          identity: {
            apiKeyName: me.apiKeyName,
            userEmail: me.userEmail,
            userId: me.userId,
            createdAt: me.createdAt
          },
          quota: parseCursorUsageSummaryPayload(rawSummary)
        };
        summaryCache.set(apiKey, { report, expiresAtMs: Date.now() + SUMMARY_CACHE_TTL_MS });
        return report;
      } catch (err) {
        return {
          maskedKey,
          status: "error",
          error: err instanceof Error ? err.message : String(err)
        };
      }
    })
  );
}
