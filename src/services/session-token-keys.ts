import crypto from "node:crypto";
import { GatewayError } from "../core/types.js";

const CURSOR_API2_BASE = "https://api2.cursor.sh";

export interface CursorAccountApiKeyItem {
  id: number | string;
  name: string;
  maskedKey: string;
  createdAt?: string | number;
  expiresAt?: string | number;
  scopes?: string[];
}

/**
 * Extract the JWT bearer segment from either:
 *  - A browser `WorkosCursorSessionToken` cookie value (`user_01...%3A%3AeyJhbG...` or `user_01...::eyJhbG...`)
 *  - A raw `eyJ...` Cursor desktop/web `accessToken` JWT
 */
export function extractBearerFromSessionToken(rawInput: string): string {
  let s = rawInput.trim();
  if (!s) {
    throw new GatewayError("`sessionToken` 不能为空。", 400, "invalid_session_token");
  }
  if (s.startsWith("WorkosCursorSessionToken=")) {
    s = s.slice("WorkosCursorSessionToken=".length).split(";")[0]!.trim();
  }
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    /* keep raw value; the eyJ check below rejects garbage */
  }
  const sepIdx = decoded.indexOf("::");
  const jwt = sepIdx >= 0 ? decoded.slice(sepIdx + 2).trim() : decoded.trim();
  if (!jwt.startsWith("eyJ")) {
    throw new GatewayError(
      "无效的 SessionToken：请传入网页 Cookie 中的 `WorkosCursorSessionToken` 值或 `eyJ...` 格式的 JWT。",
      400,
      "invalid_session_token"
    );
  }
  return jwt;
}

/**
 * List existing `crsr_...` User API Keys on a Cursor account using its `WorkosCursorSessionToken`
 * via official ConnectRPC `aiserver.v1.DashboardService/ListUserApiKeys` (zero web HTML scraping!).
 */
export async function listUserApiKeysWithSessionToken(
  sessionToken: string,
  fetcher: typeof fetch = fetch
): Promise<CursorAccountApiKeyItem[]> {
  const jwt = extractBearerFromSessionToken(sessionToken);
  const resp = await fetcher(`${CURSOR_API2_BASE}/aiserver.v1.DashboardService/ListUserApiKeys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });

  if (!resp.ok) {
    const txt = (await resp.text().catch(() => "")).slice(0, 300);
    console.error(`[SessionToken] ListUserApiKeys failed (HTTP ${resp.status}): ${txt}`);
    throw new GatewayError(
      `查询账号已有 API Key 列表失败 (上游 HTTP ${resp.status}): ${txt || resp.statusText}`,
      resp.status === 401 || resp.status === 403 ? 401 : 400,
      "cursor_dashboard_rpc_error"
    );
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const rawList = Array.isArray(data.apiKeys)
    ? data.apiKeys
    : Array.isArray(data.api_keys)
      ? data.api_keys
      : [];

  return rawList
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
    .map((item) => ({
      id: (item.id as number | string) ?? "",
      name: String(item.name ?? ""),
      maskedKey: String(item.maskedKey ?? item.masked_key ?? ""),
      ...(item.createdAt !== undefined || item.created_at !== undefined
        ? { createdAt: (item.createdAt ?? item.created_at) as string | number }
        : {}),
      ...(item.expiresAt !== undefined || item.expires_at !== undefined
        ? { expiresAt: (item.expiresAt ?? item.expires_at) as string | number }
        : {}),
      ...(Array.isArray(item.scopes) ? { scopes: item.scopes.map(String) } : {})
    }));
}

/**
 * Create a brand-new `crsr_...` User API Key from a `WorkosCursorSessionToken`
 * via official ConnectRPC `aiserver.v1.DashboardService/CreateUserApiKey`!
 */
export async function createUserApiKeyWithSessionToken(
  params: {
    sessionToken: string;
    name?: string;
    expiresAtEpochMs?: number;
  },
  fetcher: typeof fetch = fetch
): Promise<{ apiKey: string; name: string }> {
  const jwt = extractBearerFromSessionToken(params.sessionToken);
  const suffix = crypto.randomBytes(3).toString("hex");
  const keyName = params.name?.trim()
    ? `${params.name.trim()}-${suffix}`
    : `cgw-${new Date().toISOString().slice(0, 10)}-${suffix}`;
  const reqPayload: Record<string, unknown> = { name: keyName };
  if (typeof params.expiresAtEpochMs === "number" && Number.isFinite(params.expiresAtEpochMs)) {
    reqPayload.expiresAt = String(Math.floor(params.expiresAtEpochMs));
  }

  const resp = await fetcher(`${CURSOR_API2_BASE}/aiserver.v1.DashboardService/CreateUserApiKey`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(reqPayload)
  });

  if (!resp.ok) {
    const txt = (await resp.text().catch(() => "")).slice(0, 300);
    console.error(`[SessionToken] CreateUserApiKey failed (HTTP ${resp.status}): ${txt}`);
    throw new GatewayError(
      `通过 SessionToken 创建 API Key 失败 (上游 HTTP ${resp.status}): ${txt || resp.statusText}`,
      resp.status === 401 || resp.status === 403 ? 401 : 400,
      "cursor_dashboard_rpc_error"
    );
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const apiKey = String(data.apiKey ?? data.api_key ?? "").trim();
  if (!apiKey.startsWith("crsr_")) {
    throw new GatewayError("上游未返回有效的 crsr_ API Key。", 502, "invalid_upstream_response");
  }
  return { apiKey, name: keyName };
}
