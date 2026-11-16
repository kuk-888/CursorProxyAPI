import crypto from "node:crypto";
import type http from "node:http";
import type { SDKModel } from "@cursor/sdk";
import type { CursorExecutionEngine } from "../core/engine.js";
import type { PoolRoutingSettings, UpstreamKeyPool } from "../core/key-pool.js";
import { GatewayError, type GatewayConfig, type GatewayStreamEvent } from "../core/types.js";
import { isRecord } from "../protocols/common.js";
import { openAiChatAdapter } from "../protocols/openai.js";
import type { ClientGatewayKeyManager } from "../services/client-keys.js";
import type { ModelAccessController } from "../services/model-access.js";
import { listLiveModels } from "../services/model-catalog.js";
import type { UsageLedger, LedgerRange } from "../services/usage-ledger.js";
import { setOnDemandSpending, type AccountQuotaReport } from "../services/quota-service.js";
import { createUserApiKeyWithSessionToken, listUserApiKeysWithSessionToken } from "../services/session-token-keys.js";
import type { RequestTraceLogger } from "../services/request-logger.js";
import type { UsageTracker } from "../services/usage-tracker.js";
import { AdminAuthManager, clientIpOf } from "./admin-auth.js";
import { resolveAdminLang } from "./admin-i18n.js";
import { renderDashboardHtml } from "./dashboard-ui.js";

export interface WebAdminContext {
  config: GatewayConfig;
  adminAuth: AdminAuthManager;
  engine: CursorExecutionEngine;
  keyPool: UpstreamKeyPool;
  clientKeys: ClientGatewayKeyManager;
  modelAccess: ModelAccessController;
  usageTracker: UsageTracker;
  usageLedger: UsageLedger;
  traceLogger: RequestTraceLogger;
  modelListFetcher?: (apiKey: string) => Promise<SDKModel[]>;
  sessionRpcFetcher?: typeof fetch;
  onDemandFetcher?: typeof fetch;
  syncKeyQuotas: (opts: {
    includeDisabled?: boolean;
    forceRefresh?: boolean;
    includeRecoveryProbes?: boolean;
  }) => Promise<AccountQuotaReport[]>;
  tapStreamWithTrace: (
    events: AsyncGenerator<GatewayStreamEvent, void, unknown>,
    traceId: string | null,
    clientKeyId?: string
  ) => AsyncGenerator<GatewayStreamEvent, void, unknown>;
  extractClientCredential: (req: http.IncomingMessage) => string;
  readJsonBody: (req: http.IncomingMessage, maxBytes: number) => Promise<unknown>;
  sendJson: (
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    opts?: { allowCors?: boolean; extraHeaders?: Record<string, string> }
  ) => void;
  sendHtml: (res: http.ServerResponse, html: string, nonce?: string) => void;
}

/**
 * Isolated Web Console & Management API handler (`src/web/admin-routes.ts`).
 * Completely decoupled from the core OpenAI / Claude protocol proxy pipeline (`src/server.ts`).
 * Can be disabled entirely via `ENABLE_DASHBOARD=false` for pure headless deployments.
 */
export async function tryHandleWebAdminRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  route: string,
  abortSignal: AbortSignal,
  ctx: WebAdminContext
): Promise<boolean> {
  const {
    config,
    adminAuth,
    engine,
    keyPool,
    clientKeys,
    modelAccess,
    usageTracker,
    traceLogger,
    readJsonBody,
    sendJson,
    sendHtml,
    extractClientCredential
  } = ctx;

  // CSRF defence: cookie-authenticated state-changing requests must carry the console header
  // (a custom header forces a CORS preflight, which cross-site pages cannot pass). Bearer callers are unaffected
  // because requireAdminAuth ignores cookies whenever Authorization / x-api-key headers are present.
  if (
    route.startsWith("/v1/admin/") &&
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    !req.headers.authorization &&
    !req.headers["x-api-key"] &&
    adminAuth.hasSessionCookie(req) &&
    req.headers["x-console-csrf"] !== "1"
  ) {
    throw new GatewayError("Missing CSRF header.", 403, "csrf_required");
  }

  // 1. Console UI HTML (`GET <DASHBOARD_PATH>`)
  if (route === config.dashboardPath && req.method === "GET") {
    const nonce = crypto.randomBytes(16).toString("base64");
    sendHtml(res, renderDashboardHtml(config.dashboardPath, nonce), nonce);
    return true;
  }

  // 2. Session Login / Logout / Probe
  if (route === "/v1/admin/login" && req.method === "POST") {
    const body = await readJsonBody(req, 16_384);
    const pwd = isRecord(body) && typeof body.password === "string" ? body.password : "";
    const issued = adminAuth.verifyPasswordAndIssueSession(pwd, clientIpOf(req, config.trustProxy));
    sendJson(
      res,
      200,
      { ok: true, token: issued.token },
      { extraHeaders: { "set-cookie": adminAuth.buildSetCookieHeader(req, issued.token, issued.maxAgeSeconds) } }
    );
    return true;
  }

  if (route === "/v1/admin/logout" && req.method === "POST") {
    sendJson(res, 200, { ok: true }, { extraHeaders: { "set-cookie": adminAuth.buildClearCookieHeader(req) } });
    return true;
  }

  if (route === "/v1/admin/session" && req.method === "GET") {
    adminAuth.requireAdminAuth(req, extractClientCredential(req));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (route === "/v1/admin/overview" && req.method === "GET") {
    adminAuth.requireAdminAuth(req, extractClientCredential(req));
    const r = new URL(req.url || "/", "http://localhost").searchParams.get("range");
    const range: LedgerRange = r === "7d" || r === "30d" ? r : "today";
    sendJson(res, 200, {
      object: "gateway.overview",
      ...ctx.usageLedger.overview(range),
      ipRecorded: config.recordClientIp !== false,
      keyPool: keyPool.statusSnapshot()
    });
    return true;
  }

  // 3. Usage & Quota Telemetry (`/v1/usage` & `/v1/quota`)
  if ((route === "/v1/usage" || route === "/usage") && req.method === "GET") {
    adminAuth.requireAdminAuth(req, extractClientCredential(req));
    sendJson(res, 200, {
      object: "gateway.usage",
      ...usageTracker.snapshot(),
      settings: keyPool.getSettings(),
      runtime: engine.runtimeStats(),
      keyPool: keyPool.statusSnapshot(),
      affinities: keyPool.affinitySnapshot()
    });
    return true;
  }

  if ((route === "/v1/quota" || route === "/quota") && req.method === "GET") {
    const clientToken = extractClientCredential(req);
    adminAuth.requireAdminAuth(req, clientToken);
    const queryParams = new URL(req.url || "/", "http://localhost").searchParams;
    const includeDisabled = queryParams.get("includeDisabled") === "1";
    const forceRefresh = queryParams.get("force") === "1";
    // A manual sync also probes keys the gateway tripped on quota, so a top-up brings them back.
    const accounts = await ctx.syncKeyQuotas({
      includeDisabled,
      forceRefresh,
      includeRecoveryProbes: forceRefresh
    });
    sendJson(res, 200, {
      object: "cursor.quota",
      accounts,
      settings: keyPool.getSettings(),
      runtime: engine.runtimeStats(),
      keyPool: keyPool.statusSnapshot(),
      affinities: keyPool.affinitySnapshot(),
      gatewaySessionUsage: usageTracker.snapshot()
    });
    return true;
  }

  if (!route.startsWith("/v1/admin/")) {
    return false;
  }

  // All `/v1/admin/*` routes below require Admin Auth
  adminAuth.requireAdminAuth(req, extractClientCredential(req));

  // 5. Routing & Password Settings
  if (route === "/v1/admin/settings" && req.method === "POST") {
    const body = await readJsonBody(req, config.maxBodyBytes);
    if (!isRecord(body)) throw new GatewayError("JSON object expected.", 400, "invalid_request_error");
    const patch: Partial<PoolRoutingSettings> = {};
    if (body.lbStrategy === "quota-aware" || body.lbStrategy === "least-busy" || body.lbStrategy === "round-robin") {
      patch.lbStrategy = body.lbStrategy;
    }
    if (typeof body.sessionAffinityEnabled === "boolean") patch.sessionAffinityEnabled = body.sessionAffinityEnabled;
    if (typeof body.sessionAffinityTtlSeconds === "number") patch.sessionAffinityTtlSeconds = body.sessionAffinityTtlSeconds;
    if (typeof body.autoDisableExhaustedKeys === "boolean") patch.autoDisableExhaustedKeys = body.autoDisableExhaustedKeys;
    if (typeof body.allowNativeWebTools === "boolean") {
      patch.allowNativeWebTools = body.allowNativeWebTools;
      config.allowNativeWebTools = body.allowNativeWebTools;
    }
    keyPool.updateSettings(patch);
    sendJson(res, 200, { ok: true, settings: keyPool.getSettings() });
    return true;
  }

  if (route === "/v1/admin/affinity/clear" && req.method === "POST") {
    keyPool.clearAffinity();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (route === "/v1/admin/password" && req.method === "POST") {
    const body = await readJsonBody(req, 16_384);
    const newPassword = isRecord(body) && typeof body.newPassword === "string" ? body.newPassword : "";
    const issued = adminAuth.updatePassword(newPassword);
    sendJson(
      res,
      200,
      { ok: true, token: issued.token },
      { extraHeaders: { "set-cookie": adminAuth.buildSetCookieHeader(req, issued.token, issued.maxAgeSeconds) } }
    );
    return true;
  }

  // 6. Request Trace Logs
  if (route === "/v1/admin/logs" && req.method === "GET") {
    sendJson(res, 200, { logs: traceLogger.listSummaries(100) });
    return true;
  }

  if (route === "/v1/admin/logs/clear" && req.method === "POST") {
    traceLogger.clear();
    sendJson(res, 200, { ok: true });
    return true;
  }

  const logDetailMatch = /^\/v1\/admin\/logs\/(req_[a-f0-9]+)$/.exec(route);
  if (logDetailMatch && req.method === "GET") {
    const detail = traceLogger.getDetail(logDetailMatch[1]!);
    if (!detail) throw new GatewayError("Log entry not found.", 404, "not_found");
    sendJson(res, 200, detail);
    return true;
  }

  // 7. Model Access Control
  if (route === "/v1/admin/models" && req.method === "GET") {
    const live = await listLiveModels(keyPool.peekKeyForCatalog(), ctx.modelListFetcher);
    sendJson(res, 200, {
      models: modelAccess.buildAdminCatalog(live),
      disabledModels: modelAccess.disabledSnapshot()
    });
    return true;
  }

  if (route === "/v1/admin/models/batch" && req.method === "POST") {
    const body = await readJsonBody(req, config.maxBodyBytes);
    if (!isRecord(body) || typeof body.action !== "string") {
      throw new GatewayError("`action` string required.", 400, "invalid_request_error");
    }
    const action = body.action;
    if (action !== "enable" && action !== "disable" && action !== "enable_all" && action !== "set_only_enabled") {
      throw new GatewayError("Unsupported batch action.", 400, "invalid_request_error");
    }
    const models = Array.isArray(body.models) ? body.models.filter((x): x is string => typeof x === "string") : [];
    const allCatalogIds = Array.isArray(body.allCatalogIds)
      ? body.allCatalogIds.filter((x): x is string => typeof x === "string")
      : [];
    const updated = modelAccess.applyBatchUpdate({ action, models, allCatalogIds });
    sendJson(res, 200, { ok: true, ...updated });
    return true;
  }

  // 8. Client Gateway Sub-Keys
  if (route === "/v1/admin/client-keys" && req.method === "GET") {
    sendJson(res, 200, { clientKeys: clientKeys.listKeys() });
    return true;
  }

  if (route === "/v1/admin/client-keys" && req.method === "POST") {
    const body = await readJsonBody(req, config.maxBodyBytes);
    if (!isRecord(body)) throw new GatewayError("JSON object expected.", 400, "invalid_request_error");
    const lang = resolveAdminLang(req);
    const { view, rawToken } = clientKeys.createKey({
      name: typeof body.name === "string" ? body.name : (lang === "zh" ? "新建子密钥" : "New Sub-Key"),
      customToken: typeof body.customToken === "string" ? body.customToken : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      allowAllModels: typeof body.allowAllModels === "boolean" ? body.allowAllModels : true,
      allowedModels: Array.isArray(body.allowedModels)
        ? body.allowedModels.filter((x): x is string => typeof x === "string")
        : [],
      maxRequests: body.maxRequests,
      maxConcurrent: body.maxConcurrent,
      expiresAt: body.expiresAt
    });
    sendJson(res, 200, { ok: true, key: view, rawToken, clientKeys: clientKeys.listKeys() });
    return true;
  }

  const clientKeyRevealMatch = /^\/v1\/admin\/client-keys\/(gk_[a-f0-9]+)\/reveal$/.exec(route);
  if (clientKeyRevealMatch && req.method === "GET") {
    const token = clientKeys.revealKeyToken(clientKeyRevealMatch[1]!);
    sendJson(res, 200, { ok: true, token });
    return true;
  }

  const clientKeyMatch = /^\/v1\/admin\/client-keys\/(gk_[a-f0-9]+)$/.exec(route);
  if (clientKeyMatch) {
    const keyId = clientKeyMatch[1]!;
    if (req.method === "DELETE") {
      clientKeys.deleteKey(keyId);
      sendJson(res, 200, { ok: true, clientKeys: clientKeys.listKeys() });
      return true;
    }
    if (req.method === "PATCH") {
      const body = await readJsonBody(req, config.maxBodyBytes);
      if (!isRecord(body)) throw new GatewayError("JSON object expected.", 400, "invalid_request_error");
      const updated = clientKeys.updateKey(keyId, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(typeof body.allowAllModels === "boolean" ? { allowAllModels: body.allowAllModels } : {}),
        ...(Array.isArray(body.allowedModels)
          ? { allowedModels: body.allowedModels.filter((x): x is string => typeof x === "string") }
          : {}),
        ...(body.maxRequests !== undefined ? { maxRequests: body.maxRequests } : {}),
        ...(body.maxConcurrent !== undefined ? { maxConcurrent: body.maxConcurrent } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
        ...(body.resetRequests === true ? { resetRequests: true } : {})
      });
      sendJson(res, 200, { ok: true, key: updated, clientKeys: clientKeys.listKeys() });
      return true;
    }
  }

  // 9. Playground & Upstream Cursor Key Pool
  if (route === "/v1/admin/playground" && req.method === "POST") {
    const body = await readJsonBody(req, config.maxBodyBytes);
    if (!isRecord(body) || typeof body.prompt !== "string") {
      throw new GatewayError("`prompt` string required.", 400, "invalid_request_error");
    }
    const chatBody = {
      model: typeof body.model === "string" ? body.model : "grok-4.6[fast=true,effort=low]",
      stream: false,
      messages: [{ role: "user", content: body.prompt }]
    };
    const turn = openAiChatAdapter.parse(chatBody, {}, abortSignal);
    turn.scope = "admin_playground";
    const lang = resolveAdminLang(req);
    const traceId = traceLogger.startTrace("playground", turn, { keyName: lang === "zh" ? "后台拨测台" : "Playground" });
    const rawEvents = engine.executeTurnWithPool(
      turn,
      keyPool,
      (meta) => traceLogger.bindExecutionMeta(traceId, meta)
    );
    const events = ctx.tapStreamWithTrace(rawEvents, traceId);
    const json = await openAiChatAdapter.collectJson(events, turn);
    sendJson(res, 200, json);
    return true;
  }

  if (route === "/v1/admin/keys" && req.method === "POST") {
    const body = await readJsonBody(req, config.maxBodyBytes);
    if (!isRecord(body) || typeof body.apiKey !== "string") {
      throw new GatewayError("`apiKey` string required.", 400, "invalid_request_error");
    }
    const enabled = body.enabled !== false;
    const label = typeof body.label === "string" ? body.label : undefined;
    const slot = keyPool.addKey(body.apiKey, enabled, label);
    if (enabled) {
      await ctx.syncKeyQuotas({ includeDisabled: false }).catch(() => undefined);
    }
    sendJson(res, 200, { ok: true, slot, keyPool: keyPool.statusSnapshot() });
    return true;
  }

  // 8b. sessionToken -> preview existing keys / create a new `crsr_` key (admin only, nothing persisted).
  // Existing keys are only ever returned masked by Cursor, so they cannot be imported; only creation yields a usable key.
  if (route === "/v1/admin/session-token/list-keys" && req.method === "POST") {
    const body = await readJsonBody(req, config.maxBodyBytes);
    const sessionToken = isRecord(body) && typeof body.sessionToken === "string" ? body.sessionToken : "";
    const apiKeys = await listUserApiKeysWithSessionToken(sessionToken, ctx.sessionRpcFetcher);
    sendJson(res, 200, { ok: true, apiKeys });
    return true;
  }

  if (route === "/v1/admin/session-token/create-key" && req.method === "POST") {
    const body = await readJsonBody(req, config.maxBodyBytes);
    if (!isRecord(body) || typeof body.sessionToken !== "string") {
      throw new GatewayError("`sessionToken` string required.", 400, "invalid_request_error");
    }
    if (body.confirm !== true) {
      throw new GatewayError("Creating an API key requires `confirm: true`.", 400, "confirmation_required");
    }
    const name = typeof body.name === "string" ? body.name : undefined;
    const created = await createUserApiKeyWithSessionToken({ sessionToken: body.sessionToken, name }, ctx.sessionRpcFetcher);
    const slot = keyPool.addKey(created.apiKey, true, created.name);
    await ctx.syncKeyQuotas({ includeDisabled: false }).catch(() => undefined);
    // The new key is stored in the pool; it is deliberately NOT echoed back to the browser.
    sendJson(res, 200, { ok: true, name: created.name, slot, keyPool: keyPool.statusSnapshot() });
    return true;
  }

  const onDemandMatch = /^\/v1\/admin\/keys\/([a-f0-9]+)\/on-demand$/.exec(route);
  if (onDemandMatch && req.method === "POST") {
    const body = await readJsonBody(req, config.maxBodyBytes);
    if (!isRecord(body) || (body.mode !== "on" && body.mode !== "off")) {
      throw new GatewayError("`mode` must be \"on\" or \"off\".", 400, "invalid_request_error");
    }
    const target = keyPool.allManagedKeys().find((k) => k.slotId === onDemandMatch[1]);
    if (!target) throw new GatewayError("Key slot not found.", 404, "not_found");
    let result;
    try {
      result = await setOnDemandSpending(target.rawKey, body.mode, ctx.onDemandFetcher);
    } catch (err) {
      throw new GatewayError(err instanceof Error ? err.message : "On-demand update failed.", 502, "cursor_dashboard_rpc_error");
    }
    await ctx.syncKeyQuotas({ includeDisabled: true, forceRefresh: true }).catch(() => undefined);
    sendJson(res, 200, { ok: true, onDemand: result, keyPool: keyPool.statusSnapshot() });
    return true;
  }

  const recheckMatch = /^\/v1\/admin\/keys\/([a-f0-9]+)\/recheck$/.exec(route);
  if (recheckMatch && req.method === "POST") {
    const slotId = recheckMatch[1]!;
    const target = keyPool.allManagedKeys().find((k) => k.slotId === slotId);
    if (!target) throw new GatewayError("Key slot not found.", 404, "not_found");
    keyPool.recheckSlot(slotId);
    const reports = await ctx.syncKeyQuotas({ includeDisabled: false, forceRefresh: true }).catch(() => [] as AccountQuotaReport[]);
    const masked = keyPool.statusSnapshot().find((s) => s.slotId === slotId)?.maskedKey;
    const mine = reports.find((r) => r.maskedKey === masked);
    // A rejected key is tripped again right away so the console shows the real reason instead of "enabled".
    if (mine?.status === "error" && /HTTP (401|403)\b/.test(mine.error ?? "")) {
      const lang = resolveAdminLang(req);
      keyPool.reportAuthFailure(
        target.rawKey,
        lang === "zh" ? "重新检测仍被上游拒绝" : "Recheck rejected by upstream (401/403)."
      );
    }
    const status = keyPool.statusSnapshot().find((s) => s.slotId === slotId);
    sendJson(res, 200, { ok: true, recovered: Boolean(status?.enabled), slot: status, keyPool: keyPool.statusSnapshot() });
    return true;
  }

  const adminKeyMatch = /^\/v1\/admin\/keys\/([a-f0-9]+)$/.exec(route);
  if (adminKeyMatch) {
    const slotId = adminKeyMatch[1]!;
    if (req.method === "DELETE") {
      keyPool.removeKey(slotId);
      sendJson(res, 200, { ok: true, keyPool: keyPool.statusSnapshot() });
      return true;
    }
    if (req.method === "PATCH") {
      const body = await readJsonBody(req, config.maxBodyBytes);
      if (!isRecord(body)) throw new GatewayError("JSON object expected.", 400, "invalid_request_error");
      keyPool.updateSlotMeta(slotId, {
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(typeof body.label === "string" ? { label: body.label } : {}),
        ...(body.clearCooldown === true ? { clearCooldown: true } : {})
      });
      sendJson(res, 200, { ok: true, keyPool: keyPool.statusSnapshot() });
      return true;
    }
  }

  return false;
}
