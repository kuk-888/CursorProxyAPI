import net from "node:net";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  AuthenticationError,
  CursorSdkError,
  RateLimitError,
  type AgentOptions,
  type Run,
  type SDKAgent,
  type SDKMessage,
  type SDKModel,
  type SendOptions
} from "@cursor/sdk";
import type { GatewayConfig } from "../src/core/types.js";
import { baseModelId, WarmAgentPool } from "../src/core/session-pools.js";
import { computeDialogPrefixHashes, extendHashWithAssistantReply } from "../src/utils/hash.js";
import { createGatewayServer, type GatewayServerInstance } from "../src/server.js";
import { resolveModelSelection } from "../src/services/model-catalog.js";
import { parseCursorUsageSummaryPayload } from "../src/services/quota-service.js";

function makeTestConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    gatewayTokens: new Set(["gw-secret-token"]),
    adminPassword: "admin-secret-password",
    enableDashboard: true,
    dashboardPath: "/dashboard",
    cursorApiKeys: ["crsr_pool_key_0001_aaaa", "crsr_pool_key_0002_bbbb"],
    disabledCursorApiKeys: [],
    disabledModels: [],
    keyLabels: {},
    lbStrategy: "round-robin",
    sessionAffinityEnabled: true,
    sessionAffinityTtlMs: 3_600_000,
    autoDisableExhaustedKeys: true,
    runIdleTimeoutMs: 30_000,
    runMaxTimeoutMs: 60_000,
    parkedRunTtlMs: 30_000,
    maxParkedRuns: 16,
    warmSessionTtlMs: 30_000,
    maxWarmSessions: 16,
    keyCooldownMs: 10_000,
    toolBatchGraceMs: 15,
    clientKeyMaxConcurrent: 0,
    maxBodyBytes: 8 * 1024 * 1024,
    emptyWorkspaceDir: path.join(tmpdir(), "cgw-test-empty"),
    ...overrides
  };
}

const MOCK_MODELS: SDKModel[] = [
  {
    id: "grok-4.6",
    displayName: "Grok 4.6",
    parameters: [
      { id: "effort", values: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
      { id: "fast", values: [{ value: "true" }, { value: "false" }] }
    ]
  },
  {
    id: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    parameters: [{ id: "effort", values: [{ value: "low" }, { value: "high" }] }]
  }
];

function createFakeAgent(
  agentId: string,
  handler: (
    message: string | { text: string; images?: unknown[] },
    sendOpts: SendOptions | undefined,
    emit: (msg: SDKMessage) => void
  ) => Promise<void>
): SDKAgent {
  return {
    agentId,
    model: { id: "grok-4.6" },
    async send(message, sendOpts) {
      const runId = `run_${agentId}_${Date.now()}`;
      let status: "running" | "finished" | "error" | "cancelled" = "running";
      const queue: Array<SDKMessage | null> = [];
      let waiter: (() => void) | null = null;

      const push = (item: SDKMessage | null) => {
        queue.push(item);
        if (waiter) {
          const w = waiter;
          waiter = null;
          w();
        }
      };

      void (async () => {
        try {
          await handler(message as string | { text: string; images?: unknown[] }, sendOpts, (m) => push(m));
          status = "finished";
        } catch {
          status = "error";
        } finally {
          push(null);
        }
      })();

      const run: Run = {
        id: runId,
        agentId,
        supports: () => true,
        unsupportedReason: () => undefined,
        async *stream() {
          while (true) {
            if (queue.length > 0) {
              const item = queue.shift()!;
              if (item === null) return;
              yield item;
              continue;
            }
            await new Promise<void>((r) => {
              waiter = r;
            });
          }
        },
        conversation: async () => [],
        wait: async () => ({ id: runId, status: status === "running" ? "finished" : status }),
        cancel: async () => {
          status = "cancelled";
          push(null);
        },
        get status() {
          return status;
        },
        onDidChangeStatus: () => () => undefined
      };
      return run;
    },
    close() {},
    reload: async () => {},
    async [Symbol.asyncDispose]() {},
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
    getUsage: async () => ({ runs: [] } as never)
  };
}

describe("CursorProxyAPI v3.2 sticky affinity, exhaustion circuit-breaker & admin auth", () => {
  let instance: GatewayServerInstance | null = null;

  afterEach(async () => {
    if (instance) {
      await instance.close();
      instance = null;
    }
  });

  async function startServer(opts: Parameters<typeof createGatewayServer>[0]): Promise<string> {
    instance = createGatewayServer(opts);
    await new Promise<void>((resolve) => instance!.server.listen(0, "127.0.0.1", () => resolve()));
    const port = (instance.server.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  it("enforces dedicated Admin Password login gate and issues signed session cookies", async () => {
    const baseUrl = await startServer({
      config: makeTestConfig({ dashboardPath: "/adm-secret-8f2a" }),
      modelListFetcher: async () => MOCK_MODELS
    });

    // Default /dashboard must return 404 when custom DASHBOARD_PATH is configured!
    const defaultDash = await fetch(`${baseUrl}/dashboard`);
    assert.equal(defaultDash.status, 404);

    // Custom secret DASHBOARD_PATH returns 200 HTML shell
    const customDash = await fetch(`${baseUrl}/adm-secret-8f2a`);
    assert.equal(customDash.status, 200);
    const html = await customDash.text();
    assert.match(html, /const DASH_PATH = "\/adm-secret-8f2a"/);

    // Unauthenticated /v1/admin/session must fail with 401
    const unauth = await fetch(`${baseUrl}/v1/admin/session`);
    assert.equal(unauth.status, 401);

    // Wrong password must fail with 401
    const badLogin = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" })
    });
    assert.equal(badLogin.status, 401);

    // Correct ADMIN_PASSWORD returns signed adm_ token + HttpOnly cookie
    const okLogin = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-secret-password" })
    });
    assert.equal(okLogin.status, 200);
    const setCookie = okLogin.headers.get("set-cookie") || "";
    assert.match(setCookie, /cgw_admin_session=adm_/);
    assert.match(setCookie, /HttpOnly/i);
    assert.doesNotMatch(setCookie, /Secure/i);
    const spoofProto = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ password: "admin-secret-password" })
    });
    assert.doesNotMatch(spoofProto.headers.get("set-cookie") || "", /Secure/i);
    const viaProxy = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.10"
      },
      body: JSON.stringify({ password: "admin-secret-password" })
    });
    assert.match(viaProxy.headers.get("set-cookie") || "", /Secure/i);
    const { token } = (await okLogin.json()) as { token: string };

    // Session probe & admin settings succeed with signed session token
    const probe = await fetch(`${baseUrl}/v1/admin/session`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(probe.status, 200);

    // Password change API works and issues fresh session token
    const pwdRes = await fetch(`${baseUrl}/v1/admin/password`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: "updated-test-pwd" })
    });
    assert.equal(pwdRes.status, 200);
    const { token: newToken } = (await pwdRes.json()) as { token: string };
    const probe2 = await fetch(`${baseUrl}/v1/admin/session`, {
      headers: { Authorization: `Bearer ${newToken}` }
    });
    assert.equal(probe2.status, 200);
  });

  it("maintains CPA-style 1h sticky session affinity across turns AND fails over + auto-disables Account A when out of money", async () => {
    let accountAOutOfMoney = false;
    const keysUsed: string[] = [];

    const baseUrl = await startServer({
      config: makeTestConfig({
        cursorApiKeys: ["crsr_account_A_000001", "crsr_account_B_000002"],
        lbStrategy: "round-robin",
        sessionAffinityEnabled: true,
        autoDisableExhaustedKeys: true,
        maxWarmSessions: 0 // Disable WarmAgentPool here to strictly test SessionAffinityTable alone!
      }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async (opts: AgentOptions) => {
        const k = opts.apiKey || "";
        keysUsed.push(k);
        if (k === "crsr_account_A_000001" && accountAOutOfMoney) {
          throw new CursorSdkError("Monthly usage limit and included usage exhausted; upgrade to continue", {
            code: "insufficient_quota",
            isRetryable: false
          });
        }
        return createFakeAgent("aff", async (_m, _s, emit) => {
          emit({
            type: "assistant",
            agent_id: "aff",
            run_id: "r1",
            message: { role: "assistant", content: [{ type: "text", text: `served-by:${k.slice(-1)}` }] }
          });
        });
      }
    });

    // Turn 1 of Conversation Alpha -> picks Account A and binds sticky affinity!
    const t1 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.6",
        messages: [{ role: "user", content: "Project Alpha: design database schema" }]
      })
    });
    assert.equal(t1.status, 200);
    assert.equal(((await t1.json()) as { choices: Array<{ message: { content: string } }> }).choices[0].message.content, "served-by:1");

    // Turn 2 & Turn 3 of Conversation Alpha -> even though lbStrategy is round-robin,
    // sticky Session Affinity keeps pinning Alpha to Account A (NOT jumping to Account B)!
    for (const followUp of ["Add indexes", "Add foreign keys"]) {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "grok-4.6",
          messages: [
            { role: "user", content: "Project Alpha: design database schema" },
            { role: "assistant", content: "served-by:1" },
            { role: "user", content: followUp }
          ]
        })
      });
      assert.equal(res.status, 200);
      const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      assert.equal(j.choices[0].message.content, "served-by:1");
    }

    // Meanwhile, a DIFFERENT Conversation Beta -> Round-Robin routes Beta to Account B!
    const betaRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.6",
        messages: [{ role: "user", content: "Project Beta: completely separate window" }]
      })
    });
    assert.equal(((await betaRes.json()) as { choices: Array<{ message: { content: string } }> }).choices[0].message.content, "served-by:2");

    // NOW Account A runs out of money!
    accountAOutOfMoney = true;

    // Turn 4 of Conversation Alpha -> tries sticky Account A, detects quota exhaustion,
    // AUTOMATICALLY disables Account A, seamlessly fails over to Account B in the SAME request,
    // and rebinds Conversation Alpha to Account B!
    const t4 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.6",
        messages: [
          { role: "user", content: "Project Alpha: design database schema" },
          { role: "assistant", content: "served-by:1" },
          { role: "user", content: "Turn 4 when A has no money" }
        ]
      })
    });
    assert.equal(t4.status, 200);
    const j4 = (await t4.json()) as { choices: Array<{ message: { content: string } }> };
    assert.equal(j4.choices[0].message.content, "served-by:2");

    // Verify Account A is now automatically disabled (`enabled === false`) with `autoDisabledReason`!
    const clientTryUsage = await fetch(`${baseUrl}/v1/usage`, { headers: { Authorization: "Bearer gw-secret-token" } });
    assert.equal(clientTryUsage.status, 401);

    const usageSnap = (await (
      await fetch(`${baseUrl}/v1/usage`, { headers: { Authorization: "Bearer admin-secret-password" } })
    ).json()) as { keyPool: Array<{ maskedKey: string; enabled: boolean; autoDisabledReason?: string }> };

    const slotA = usageSnap.keyPool[0]!;
    const slotB = usageSnap.keyPool[1]!;
    assert.equal(slotA.enabled, false, "Exhausted Account A must be automatically disabled!");
    assert.match(slotA.autoDisabledReason || "", /额度耗尽自动熔断/);
    assert.equal(slotB.enabled, true);

    // The metadata-only overview ledger saw the same traffic (no conversation text in it).
    const ovRes = await fetch(`${baseUrl}/v1/admin/overview?range=today`, { headers: { Authorization: "Bearer admin-secret-password" } });
    assert.equal(ovRes.status, 200);
    const ovText = await ovRes.text();
    const ov = JSON.parse(ovText) as { totals: { requests: number }; byModel: Array<{ name: string }>; byIp: Array<{ name: string }> };
    assert.ok(ov.totals.requests >= 4);
    assert.equal(ov.byModel[0]!.name, "grok-4.6");
    assert.ok(ov.byIp.length >= 1 && ov.byIp[0]!.name !== "-");
    assert.ok(!ovText.includes("Project Alpha"), "ledger must never contain message content");
    const noAuth = await fetch(`${baseUrl}/v1/admin/overview`, { headers: { Authorization: "Bearer gw-secret-token" } });
    assert.equal(noAuth.status, 401);
  });

  it("parses dual-pool quotas, blocks On-Demand overspend, and hot-manages keys", async () => {
    const quota = parseCursorUsageSummaryPayload({
      membershipType: "pro",
      individualUsage: {
        plan: {
          enabled: true,
          limit: 2000,
          breakdown: { included: 2000, bonus: 10551, total: 12551 },
          autoPercentUsed: 17.83,
          apiPercentUsed: 100,
          totalPercentUsed: 25.36
        },
        onDemand: { enabled: true, used: 2127, limit: null, remaining: null }
      }
    });
    assert.equal(quota.cursorModelsAutoPool.remainingPercent, 82.17);
    assert.equal(quota.premiumApiPool.remainingPercent, 0);

    const usedKeys: string[] = [];
    const baseUrl = await startServer({
      config: makeTestConfig({
        cursorApiKeys: ["crsr_rate_limited_key_0001", "crsr_healthy_key_0002"]
      }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async (opts: AgentOptions) => {
        usedKeys.push(opts.apiKey || "");
        if (opts.apiKey === "crsr_rate_limited_key_0001") {
          throw new RateLimitError("429 burst");
        }
        return createFakeAgent("ok", async (_m, _s, emit) => {
          emit({
            type: "assistant",
            agent_id: "ok",
            run_id: "r1",
            message: { role: "assistant", content: [{ type: "text", text: "ok" }] }
          });
        });
      }
    });

    const r = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(r.status, 200);
    assert.deepEqual(usedKeys, ["crsr_rate_limited_key_0001", "crsr_healthy_key_0002"]);

    // Verify /v1/admin/logs holds metadata only (counts, timings, fingerprints), never conversation text.
    const logsRes = await fetch(`${baseUrl}/v1/admin/logs`, {
      headers: { Authorization: "Bearer admin-secret-password" }
    });
    assert.equal(logsRes.status, 200);
    const logsJson = (await logsRes.json()) as { logs: Array<{ id: string; status: string; outputChars: number }> };
    assert.equal(logsJson.logs.length, 1);
    assert.equal(logsJson.logs[0]!.status, "success");
    assert.equal(logsJson.logs[0]!.outputChars, 2);

    const detailRes = await fetch(`${baseUrl}/v1/admin/logs/${logsJson.logs[0]!.id}`, {
      headers: { Authorization: "Bearer admin-secret-password" }
    });
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as { messageCount: number; request?: unknown; response?: unknown };
    assert.equal(detailJson.messageCount, 1);
    assert.equal(detailJson.request, undefined);
    assert.equal(detailJson.response, undefined);

    // Test batch model access control: disable `claude-opus-5-5`, verify hidden from /v1/models and rejected with 403!
    const batchDisableRes = await fetch(`${baseUrl}/v1/admin/models/batch`, {
      method: "POST",
      headers: { Authorization: "Bearer admin-secret-password", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable", models: ["claude-opus-5-5"] })
    });
    assert.equal(batchDisableRes.status, 200);

    const visibleModelsRes = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: "Bearer gw-secret-token" }
    });
    const visibleModels = (await visibleModelsRes.json()) as { data: Array<{ id: string }> };
    assert.deepEqual(visibleModels.data.map((m) => m.id), ["grok-4.6"]);

    const blockedModelCall = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-5-5[effort=high]", messages: [{ role: "user", content: "blocked" }] })
    });
    assert.equal(blockedModelCall.status, 403);

    assert.equal(resolveModelSelection("grok-4.6[fast=true,effort=low]", {}).selection.id, "grok-4.6");
  });

  it("returns 404 model_not_found for unknown models before pool logic", async () => {
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS
    });
    const r = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "no-such-model-zzz", messages: [{ role: "user", content: "x" }] })
    });
    assert.equal(r.status, 404);
    const body = (await r.json()) as { error: { code: string } };
    assert.equal(body.error.code, "model_not_found");
  });

  it("adapts parameters across diverse model schemas AND enforces per-subkey model allowlists", async () => {
    // 1. Schema-driven parameter adaptation across GPT-5.4, Claude Opus 5, Kimi K3, and no-param Gemini 3.1 Pro
    const gpt54Schema: SDKModel = {
      id: "gpt-5.4",
      displayName: "GPT-5.4",
      parameters: [
        { id: "context", values: [{ value: "272k" }, { value: "1m" }] },
        { id: "reasoning", values: [{ value: "none" }, { value: "low" }, { value: "medium" }, { value: "high" }, { value: "extra-high" }] },
        { id: "fast", values: [{ value: "false" }, { value: "true" }] }
      ]
    };
    const gptSel = resolveModelSelection("gpt-5.4[effort=xhigh,1m]", { service_tier: "priority" }, gpt54Schema);
    assert.deepEqual(gptSel.selection.params, [
      { id: "fast", value: "true" },
      { id: "reasoning", value: "extra-high" },
      { id: "context", value: "1m" }
    ]);

    const claudeOpus5Schema: SDKModel = {
      id: "claude-opus-5",
      displayName: "Claude Opus 5",
      parameters: [
        { id: "thinking", values: [{ value: "false" }, { value: "true" }] },
        { id: "effort", values: [{ value: "low" }, { value: "medium" }, { value: "high" }, { value: "xhigh" }, { value: "max" }] }
      ]
    };
    const claudeSel = resolveModelSelection(
      "claude-opus-5",
      { thinking: { type: "enabled", budget_tokens: 16000 } },
      claudeOpus5Schema
    );
    assert.deepEqual(claudeSel.selection.params, [
      { id: "thinking", value: "true" },
      { id: "effort", value: "high" }
    ]);

    const kimiSchema: SDKModel = {
      id: "kimi-k3",
      displayName: "Kimi K3",
      parameters: [{ id: "reasoning", values: [{ value: "low" }, { value: "high" }, { value: "max" }] }]
    };
    const kimiSel = resolveModelSelection("kimi-k3", { reasoning_effort: "medium" }, kimiSchema);
    assert.deepEqual(kimiSel.selection.params, [{ id: "reasoning", value: "high" }]);

    const noParamGemini: SDKModel = { id: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro", parameters: [] };
    const gemSel = resolveModelSelection("gemini-3.1-pro", { reasoning_effort: "high", fast: true }, noParamGemini);
    assert.equal(gemSel.selection.params, undefined, "Unsupported params must be stripped for no-param models");

    // grok-4.7 500k snapping & magnitude suffix parsing
    const grok47Schema: SDKModel = {
      id: "grok-4.7",
      displayName: "Grok 4.7",
      parameters: [
        { id: "context", values: [{ value: "256k" }, { value: "500k" }] },
        { id: "reasoning_effort", values: [{ value: "low" }, { value: "medium" }, { value: "high" }, { value: "xhigh" }] }
      ]
    };
    const grok500kSuffix = resolveModelSelection("grok-4.7-500k", {}, grok47Schema);
    assert.equal(grok500kSuffix.selection.id, "grok-4.7");
    assert.deepEqual(grok500kSuffix.selection.params, [{ id: "context", value: "256k" }]);

    const grokBracket500k = resolveModelSelection("grok-4.7[reasoning_effort=high,context=500k]", {}, grok47Schema);
    assert.equal(grokBracket500k.selection.id, "grok-4.7");
    assert.deepEqual(grokBracket500k.selection.params, [
      { id: "reasoning_effort", value: "high" },
      { id: "context", value: "256k" }
    ]);

    // 2. Multi-Client Gateway Sub-Keys with different allowed model lists
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("subk", async (_m, _s, emit) => {
          emit({
            type: "assistant",
            agent_id: "subk",
            run_id: "r1",
            message: { role: "assistant", content: [{ type: "text", text: "subkey-ok" }] }
          });
        })
    });

    const loginRes = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-secret-password" })
    });
    const { token: adminSession } = (await loginRes.json()) as { token: string };

    // Create Sub-Key A (only `grok-4.6`) and Sub-Key B (only `claude-opus-5-5`)
    const ckARes = await fetch(`${baseUrl}/v1/admin/client-keys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSession}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Frontend Grok Key",
        customToken: "sk-cgw-grok-only",
        allowAllModels: false,
        allowedModels: ["grok-4.6"]
      })
    });
    assert.equal(ckARes.status, 200);

    const ckBRes = await fetch(`${baseUrl}/v1/admin/client-keys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSession}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "VIP Claude Key",
        customToken: "sk-cgw-claude-only",
        allowAllModels: false,
        allowedModels: ["claude-opus-5-5"]
      })
    });
    assert.equal(ckBRes.status, 200);

    // Sub-Key A /v1/models only sees grok-4.6; Sub-Key B only sees claude-opus-5-5!
    const mA = (await (
      await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: "Bearer sk-cgw-grok-only" } })
    ).json()) as { data: Array<{ id: string }> };
    assert.deepEqual(mA.data.map((x) => x.id), ["grok-4.6"]);

    const mB = (await (
      await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: "Bearer sk-cgw-claude-only" } })
    ).json()) as { data: Array<{ id: string }> };
    assert.deepEqual(mB.data.map((x) => x.id), ["claude-opus-5-5"]);

    // Sub-Key A calling claude-opus-5-5 -> 403 Forbidden!
    const forbiddenCall = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer sk-cgw-grok-only", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(forbiddenCall.status, 403);

    // Sub-Key A calling grok-4.6[effort=high] -> 200 OK!
    const allowedCall = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer sk-cgw-grok-only", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6[effort=high]", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(allowedCall.status, 200);

    // Sub-Key A cannot access /v1/admin/* -> 401!
    const privEsc = await fetch(`${baseUrl}/v1/admin/client-keys`, {
      headers: { Authorization: "Bearer sk-cgw-grok-only" }
    });
    assert.equal(privEsc.status, 401);

    // 3. Test Sub-Key maxRequests cap, reset, and expiresAt enforcement!
    const ckLimitedRes = await fetch(`${baseUrl}/v1/admin/client-keys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSession}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "1-Shot Trial Key",
        customToken: "sk-cgw-once-only",
        allowAllModels: true,
        maxRequests: 1,
        expiresAt: new Date(Date.now() + 3600_000).toISOString()
      })
    });
    assert.equal(ckLimitedRes.status, 200);
    const limitedId = ((await ckLimitedRes.json()) as { key: { id: string } }).key.id;

    // 1st call succeeds (1/1)
    const call1 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer sk-cgw-once-only", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "use 1st" }] })
    });
    assert.equal(call1.status, 200);

    // 2nd call hits maxRequests cap -> 429 api_key_quota_exceeded!
    const call2 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer sk-cgw-once-only", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "use 2nd" }] })
    });
    assert.equal(call2.status, 429);

    // Reset requests AND set past expiresAt -> rejects with 403 api_key_expired!
    await fetch(`${baseUrl}/v1/admin/client-keys/${limitedId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminSession}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resetRequests: true,
        expiresAt: new Date(Date.now() - 5000).toISOString()
      })
    });
    const callExpired = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer sk-cgw-once-only", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "expired" }] })
    });
    assert.equal(callExpired.status, 403);

    const extHealth = await fetch(`${baseUrl}/health`, {
      headers: { "X-Forwarded-For": "203.0.113.99" }
    });
    assert.equal(extHealth.status, 200);
    assert.equal(((await extHealth.json()) as { ok: boolean }).ok, true);
  });

  it("isolates warm sessions between client keys (identical history must not reuse another client's agent)", async () => {
    let created = 0;
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () => {
        created += 1;
        return createFakeAgent(`iso${created}`, async (_m, _s, emit) => {
          emit({
            type: "assistant",
            agent_id: `iso${created}`,
            run_id: "r1",
            message: { role: "assistant", content: [{ type: "text", text: "hello there" }] }
          });
        });
      }
    });
    const login = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-secret-password" })
    });
    const { token } = (await login.json()) as { token: string };
    for (const [name, tok] of [["iso-A", "sk-cgw-iso-a"], ["iso-B", "sk-cgw-iso-b"]]) {
      const r = await fetch(`${baseUrl}/v1/admin/client-keys`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, customToken: tok })
      });
      assert.equal(r.status, 200);
    }
    const chat = async (tok: string, messages: unknown[]) =>
      fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "grok-4.6", messages })
      });
    const h1 = [{ role: "user", content: "Hi" }];
    assert.equal((await chat("sk-cgw-iso-a", h1)).status, 200);
    const h2 = [...h1, { role: "assistant", content: "hello there" }, { role: "user", content: "next" }];
    assert.equal((await chat("sk-cgw-iso-b", h2)).status, 200);
    assert.equal(created, 2, "client B must not claim client A's warm agent");
    assert.equal((await chat("sk-cgw-iso-a", h2)).status, 200);
    assert.equal(created, 2, "client A still reuses its own warm agent");
  });

  it("keeps admin sessions valid across restarts and invalidates them when the password changes", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(path.join(tmpdir(), "cgw-sess-"));
    const envFilePath = path.join(dir, ".env");
    writeFileSync(envFilePath, "ADMIN_PASSWORD=admin-secret-password\n");
    const { AdminAuthManager } = await import("../src/web/admin-auth.js");
    const cfg = { adminPassword: "admin-secret-password", gatewayTokens: new Set<string>(), envFilePath };
    const first = new AdminAuthManager(cfg);
    const { token } = first.verifyPasswordAndIssueSession("admin-secret-password", "1.1.1.1");
    const afterRestart = new AdminAuthManager(cfg);
    assert.equal(afterRestart.verifySignedSessionToken(token), true, "session must survive a process restart");
    afterRestart.updatePassword("a-brand-new-password");
    assert.equal(afterRestart.verifySignedSessionToken(token), false, "password change revokes old sessions");
    // one noisy IP never locks out others
    for (let i = 0; i < 50; i++) {
      try { afterRestart.verifyPasswordAndIssueSession(`bad${i}`, "9.9.9.9"); } catch { /* expected */ }
    }
    assert.ok(afterRestart.verifyPasswordAndIssueSession("a-brand-new-password", "8.8.8.8").token);
  });

  it("never accepts a crsr_ upstream key as a caller credential (no passthrough, no upstream use)", async () => {
    const seenKeys: string[] = [];
    const poolKey = "crsr_pool_key_0001_aaaa";
    const stolen = "crsr_attacker_supplied_000000000001";
    const mkFactory = () => async (opts: { apiKey?: string }) => {
      seenKeys.push(String(opts.apiKey));
      return createFakeAgent("p", async (_m, _s, emit) => {
        emit({ type: "assistant", agent_id: "p", run_id: "r", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
      });
    };
    const body = JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }] });
    const attempt = async (baseUrl: string, token: string) => {
      const out: number[] = [];
      for (const path of ["/v1/chat/completions", "/v1/messages", "/v1/models"]) {
        const r = await fetch(`${baseUrl}${path}`, {
          method: path === "/v1/models" ? "GET" : "POST",
          headers: { Authorization: `Bearer ${token}`, "x-api-key": token, "Content-Type": "application/json" },
          ...(path === "/v1/models" ? {} : { body })
        });
        out.push(r.status);
        assert.doesNotMatch(await r.text(), /crsr_/, "response must never echo a crsr_ key");
      }
      return out;
    };

    // 1) gateway token configured (sub-keys exist): both the pool's own key and a foreign key are rejected
    let baseUrl = await startServer({ config: makeTestConfig(), modelListFetcher: async () => MOCK_MODELS, agentFactory: mkFactory() as never });
    assert.deepEqual(await attempt(baseUrl, stolen), [401, 401, 401]);
    assert.deepEqual(await attempt(baseUrl, poolKey), [401, 401, 401]);
    await new Promise<void>((r) => instance!.server.close(() => r()));

    // 2) no gateway tokens, no sub-keys, empty pool: still never usable as a credential
    baseUrl = await startServer({
      config: makeTestConfig({ gatewayTokens: new Set<string>(), cursorApiKeys: [] }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: mkFactory() as never
    });
    assert.deepEqual(await attempt(baseUrl, stolen), [401, 401, 401]);

    assert.deepEqual(seenKeys, [], "agentFactory must never run for a rejected crsr_ credential");
  });

  it("returns real HTTP statuses for pre-stream upstream failures and never maps upstream 401 to a client 401", async () => {
    const H = { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" };
    for (const stream of [true, false]) {
      // fresh server per branch: the first upstream auth failure auto-disables the only key
      if (instance) { await instance.close(); instance = null; }
      const baseUrl = await startServer({
        config: makeTestConfig({ cursorApiKeys: ["crsr_upstream_key_0000001"] }),
        modelListFetcher: async () => MOCK_MODELS,
        agentFactory: async () => { throw new AuthenticationError("401 bad upstream key"); }
      });
      const r = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST", headers: H,
        body: JSON.stringify({ model: "grok-4.6", stream, messages: [{ role: "user", content: "hi" }] })
      });
      assert.equal(r.status, 502, `stream=${stream} got ${r.status}: ${(await r.clone().text()).slice(0, 300)}`);
      assert.ok(!(r.headers.get("content-type") ?? "").includes("event-stream"));
      const text = await r.text();
      assert.ok(!text.includes("crsr_"), "must not leak the upstream key");
    }
  });

  it("surfaces the real 429 when every key is rate limited, and keys warm-reuse apart when only a history image differs", async () => {
    const baseUrl = await startServer({
      config: makeTestConfig({ cursorApiKeys: ["crsr_rl_key_000000001", "crsr_rl_key_000000002"] }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () => { throw new RateLimitError("429 burst"); }
    });
    const r = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(r.status, 429, `expected the real 429, got ${r.status}: ${await r.text()}`);

    const mk = (data: string) => computeDialogPrefixHashes({
      systemPrompt: "s", toolNamesSignature: "",
      items: [
        { role: "user", text: "look", images: [{ data, mimeType: "image/png" }], hasTools: false },
        { role: "assistant", text: "ok", images: [], hasTools: false },
        { role: "user", text: "and now?", images: [], hasTools: false }
      ]
    });
    assert.notEqual(mk("AAAA").priorPrefixHash, mk("BBBB").priorPrefixHash);
    assert.equal(mk("AAAA").priorPrefixHash, mk("AAAA").priorPrefixHash);
  });

  it("rejects unsupported structured options, declares ignored params, and keeps tool_choice hints out of user text", async () => {
    const prompts: string[] = [];
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("tc", async (m, _s, emit) => {
          prompts.push(typeof m === "string" ? m : m.text);
          emit({ type: "assistant", agent_id: "tc", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
        })
    });
    const H = { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" };
    const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
    const base = { model: "grok-4.6", messages: [{ role: "user", content: "hello" }] };

    assert.equal((await post("/v1/chat/completions", { ...base, response_format: { type: "json_schema", json_schema: {} } })).status, 400);
    assert.equal((await post("/v1/chat/completions", { ...base, n: 2 })).status, 400);
    const prev = await post("/v1/responses", { model: "grok-4.6", input: "hi", previous_response_id: "resp_1" });
    assert.equal(prev.status, 400);
    assert.equal(((await prev.json()) as { error: { code: string; param: string } }).error.code, "unsupported_parameter");
    assert.equal((await post("/v1/responses", { model: "grok-4.6", input: "hi", text: { format: { type: "json_object" } } })).status, 400);

    const ok = await post("/v1/chat/completions", { ...base, temperature: 0.2, max_tokens: 5, response_format: { type: "text" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-gateway-ignored-params"), "temperature,max_tokens");

    // tool_choice=required: hint lives in <system>, user text stays untouched, and it is dropped after a tool result
    const tools = [{ type: "function", function: { name: "lookup", description: "d", parameters: { type: "object", properties: {} } } }];
    await post("/v1/chat/completions", { ...base, tools, tool_choice: "required" });
    const first = prompts[prompts.length - 1]!;
    assert.match(first, /<system>[\s\S]*Invoke at least one provided tool[\s\S]*<\/system>/);

    const twoTools = [
      { type: "function", function: { name: "alpha_tool", description: "a", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "beta_tool", description: "b", parameters: { type: "object", properties: {} } } }
    ];
    await post("/v1/chat/completions", { ...base, tools: twoTools, tool_choice: "required" });
    assert.match(prompts[prompts.length - 1]!, /call at least one of the provided tools[\s\S]*alpha_tool, beta_tool/);
    assert.ok(first.trimEnd().endsWith("hello"), "user text must not get an instruction appended");

    await post("/v1/chat/completions", {
      ...base, tools, tool_choice: "required",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_x", type: "function", function: { name: "lookup", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_x", content: "result" }
      ]
    });
    assert.ok(!/Invoke at least one provided tool/.test(prompts[prompts.length - 1]!), "no forced tool call once a tool result exists");
  });

  it("does not consume a lease for /v1/models, compares model ids canonically, and survives same-hash warm overwrite", async () => {
    const baseUrl = await startServer({ config: makeTestConfig(), modelListFetcher: async () => MOCK_MODELS });
    const snap = async () => {
      const r = await fetch(`${baseUrl}/v1/usage`, { headers: { Authorization: "Bearer admin-secret-password" } });
      assert.equal(r.status, 200);
      const j = (await r.json()) as { keyPool: Array<{ totalSelected: number; activeInflight: number }> };
      assert.ok(j.keyPool.length > 0, "pool snapshot must list keys");
      return j.keyPool.map((k) => `${k.totalSelected}/${k.activeInflight}`).join(",");
    };
    const before = await snap();
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: "Bearer gw-secret-token" } });
      assert.equal(r.status, 200);
    }
    const after = await snap();
    assert.equal(before, after, "listing models must not change pool selection counters");

    assert.equal(baseModelId("Grok-4.6-FAST[effort=high]"), "grok-4.6");
    assert.equal(baseModelId("grok-4.6"), "grok-4.6");

    const closed: string[] = [];
    const pool = new WarmAgentPool({ maxItems: 4, ttlMs: 30, onCloseAgent: async (a) => { closed.push(a.agentId); } });
    const mkExec = (id: string) => ({
      disposed: false, hadToolCallsInRun: false, currentInputPrefixHash: "h1", assistantTextAccumulator: "reply",
      apiKey: "k", canonicalModelId: "grok-4.6", hasMcpTools: false, scope: "s",
      agent: { agentId: id } as unknown as SDKAgent
    });
    assert.ok(pool.store(mkExec("old") as never));
    assert.ok(pool.store(mkExec("new") as never));
    assert.deepEqual(closed, ["old"], "the replaced agent is closed immediately");
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(closed.sort(), ["new", "old"], "each agent is closed exactly once");
    assert.equal(pool.size, 0);

    const closedIso: string[] = [];
    const iso = new WarmAgentPool({ maxItems: 4, ttlMs: 60_000, onCloseAgent: async (a) => { closedIso.push(a.agentId); } });
    const mkScoped = (id: string, scope: string) => ({
      disposed: false, hadToolCallsInRun: false, currentInputPrefixHash: "h1", assistantTextAccumulator: "reply",
      apiKey: "k", canonicalModelId: "grok-4.6", hasMcpTools: false, scope,
      agent: { agentId: id } as unknown as SDKAgent
    });
    assert.ok(iso.store(mkScoped("scopeA-agent", "scopeA") as never));
    assert.ok(iso.store(mkScoped("scopeB-agent", "scopeB") as never));
    assert.equal(iso.size, 2, "identical prefix hashes in different scopes must not overwrite");
    const warmHash = extendHashWithAssistantReply("h1", "reply");
    const claimA = iso.tryClaim({
      priorPrefixHash: warmHash, incrementalUserText: "next", hasTrailingToolResults: false,
      hasMcpTools: false, requestedBaseModel: "grok-4.6", scope: "scopeA", isKeyUsable: () => true
    });
    const claimB = iso.tryClaim({
      priorPrefixHash: warmHash, incrementalUserText: "next", hasTrailingToolResults: false,
      hasMcpTools: false, requestedBaseModel: "grok-4.6", scope: "scopeB", isKeyUsable: () => true
    });
    assert.equal(claimA?.agent.agentId, "scopeA-agent");
    assert.equal(claimB?.agent.agentId, "scopeB-agent");
    assert.deepEqual(closedIso, []);
  });

  it("refuses to silently drop unsupported input blocks and keeps trailing user text after Responses tool outputs", async () => {
    const baseUrl = await startServer({ config: makeTestConfig(), modelListFetcher: async () => MOCK_MODELS });
    const H = { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" };
    const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });

    // Anthropic: a PDF document attachment must be rejected, not ignored
    const pdf = await post("/v1/messages", {
      model: "grok-4.6", max_tokens: 16,
      messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } }, { type: "text", text: "summarize" }] }]
    });
    assert.equal(pdf.status, 400);
    assert.match(await pdf.text(), /document/);

    // Anthropic: unknown block type rejected; thinking blocks from history are fine to drop
    const weird = await post("/v1/messages", { model: "grok-4.6", max_tokens: 16, messages: [{ role: "user", content: [{ type: "hologram", data: "x" }] }] });
    assert.equal(weird.status, 400);

    // Responses: unknown item type rejected
    const item = await post("/v1/responses", { model: "grok-4.6", input: [{ type: "computer_call_output", call_id: "c1", output: "x" }] });
    assert.equal(item.status, 400);
  });

  it("caps in-flight requests only for keys that set maxConcurrent, and releases slots afterwards", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("cc", async (_m, _s, emit) => {
          await gate;
          emit({ type: "assistant", agent_id: "cc", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
        })
    });
    const login = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-secret-password" })
    });
    const { token } = (await login.json()) as { token: string };
    await fetch(`${baseUrl}/v1/admin/client-keys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "cc", customToken: "sk-cgw-cc", maxConcurrent: 1 })
    });
    await fetch(`${baseUrl}/v1/admin/client-keys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "free", customToken: "sk-cgw-free" })
    });
    const chat = (tok: string, text: string) =>
      fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: text }] })
      });
    const first = chat("sk-cgw-cc", "one");
    await new Promise((r) => setTimeout(r, 200));
    const second = await chat("sk-cgw-cc", "two");
    assert.equal(second.status, 429);
    assert.ok(second.headers.get("retry-after"));
    const unlimited = chat("sk-cgw-free", "other-1");
    const unlimited2 = chat("sk-cgw-free", "other-2");
    await new Promise((r) => setTimeout(r, 100));
    release();
    assert.equal((await unlimited).status, 200, "a key without a limit is not throttled");
    assert.equal((await unlimited2).status, 200);
    assert.equal((await first).status, 200);
    assert.equal((await chat("sk-cgw-cc", "three")).status, 200, "slot must be released after completion");
  });

  it("namespaces conversation affinity keys by client key", async () => {
    const seen: Array<string | undefined> = [];
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("af", async (_m, _s, emit) => {
          emit({ type: "assistant", agent_id: "af", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
        })
    });
    const login = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-secret-password" })
    });
    const { token } = (await login.json()) as { token: string };
    for (const [name, tok] of [["af-A", "sk-cgw-af-a"], ["af-B", "sk-cgw-af-b"]]) {
      await fetch(`${baseUrl}/v1/admin/client-keys`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, customToken: tok })
      });
    }
    for (const tok of ["sk-cgw-af-a", "sk-cgw-af-b"]) {
      const r = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", "x-session-id": "same-session" },
        body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }] })
      });
      assert.equal(r.status, 200);
    }
    const usage = await fetch(`${baseUrl}/v1/usage`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await usage.json()) as { affinities: Array<{ conversationKey: string }> };
    for (const a of body.affinities) seen.push(a.conversationKey);
    assert.equal(seen.length, 2, "same x-session-id from two clients must create two bindings");
  });

  it("serves the console with a nonce CSP, no inline handlers, and enforces the CSRF header for cookie sessions", async () => {
    const baseUrl = await startServer({ config: makeTestConfig(), modelListFetcher: async () => MOCK_MODELS });
    const page = await fetch(`${baseUrl}/dashboard`);
    const csp = page.headers.get("content-security-policy") ?? "";
    const html = await page.text();
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce);
    assert.ok(html.includes(`<script nonce="${nonce}">`));
    assert.ok(!/\son(click|change|input|submit|keydown)=/.test(html), "inline handlers are blocked by CSP");
    assert.ok(!csp.includes("unsafe-inline'") || !/script-src[^;]*unsafe-inline/.test(csp));

    const login = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Console-CSRF": "1" },
      body: JSON.stringify({ password: "admin-secret-password" })
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const noHeader = await fetch(`${baseUrl}/v1/admin/affinity/clear`, { method: "POST", headers: { cookie } });
    assert.equal(noHeader.status, 403);
    const withHeader = await fetch(`${baseUrl}/v1/admin/affinity/clear`, {
      method: "POST",
      headers: { cookie, "X-Console-CSRF": "1" }
    });
    assert.equal(withHeader.status, 200);
  });

  it("delivers images attached to parked tool results and trailing user messages to the suspended SDK tool call", async () => {
    let received: unknown;
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("img", async (_m, sendOpts, emit) => {
          const tool = (sendOpts?.local?.customTools as Record<string, { execute: (a: Record<string, never>, c: { toolCallId: string }) => Promise<unknown> }>)["vault"];
          received = await tool.execute({}, { toolCallId: "sdk1" });
          emit({
            type: "assistant",
            agent_id: "img",
            run_id: "r1",
            message: { role: "assistant", content: [{ type: "text", text: "done" }] }
          });
        })
    });
    const tools = [{ type: "function", function: { name: "vault", description: "d", parameters: { type: "object", properties: {} } } }];
    const post = (messages: unknown[]) =>
      fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "grok-4.6", messages, tools })
      });
    const first = (await (await post([{ role: "user", content: "go" }])).json()) as {
      choices: Array<{ message: { tool_calls: Array<{ id: string }> } }>;
    };
    if (!first.choices) throw new Error(JSON.stringify(first));
    const msg = first.choices[0]!.message;
    if (!msg.tool_calls) throw new Error(JSON.stringify(first));
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const res = await post([
      { role: "user", content: "go" },
      msg,
      { role: "tool", tool_call_id: msg.tool_calls[0]!.id, content: [{ type: "text", text: "tool says hi" }, { type: "image_url", image_url: { url: png } }] },
      { role: "user", content: [{ type: "text", text: "and this one" }, { type: "image_url", image_url: { url: png } }] }
    ]);
    assert.equal(res.status, 200);
    const r = received as { content: Array<{ type: string; text?: string; data?: string }> };
    assert.equal(r.content.filter((c) => c.type === "image").length, 2, "tool image + trailing user image both forwarded");
    assert.ok(r.content.some((c) => c.type === "text" && c.text?.includes("tool says hi") && c.text.includes("and this one")));
  });

  it("transparently auto-repairs common model argument mistakes like path -> filePath without bouncing", async () => {
    type CT = Record<string, { execute: (a: Record<string, unknown>, c: { toolCallId: string }) => Promise<unknown> }>;
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("autorepair", async (_m, sendOpts, emit) => {
          const tool = (sendOpts?.local?.customTools as CT)["read"]!;
          // Model emitted `path: "/etc/hostname"` instead of `filePath`
          void tool.execute({ path: "/etc/hostname" }, { toolCallId: "sdk1" }).catch(() => undefined);
          emit({ type: "tool_call", agent_id: "autorepair", run_id: "r1", call_id: "sdk1", name: "read", status: "running" } as never);
        })
    });
    const tools = [{
      type: "function",
      function: { name: "read", description: "d", parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } }
    }];
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "read" }], tools })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { choices: Array<{ message: { tool_calls?: Array<{ function: { arguments: string } }> } }> };
    const calls = body.choices[0]!.message.tool_calls ?? [];
    assert.equal(calls.length, 1);
    const args = JSON.parse(calls[0]!.function.arguments);
    assert.equal(args.filePath, "/etc/hostname", "filePath must be auto-populated from path");
    assert.equal(args.path, "/etc/hostname", "original path key preserved");
  });

  it("bounces schema-invalid tool args back to the model once (client never sees them), then lets a stubborn call through", async () => {
    type CT = Record<string, { execute: (a: Record<string, unknown>, c: { toolCallId: string }) => Promise<unknown> }>;
    const results: unknown[] = [];
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("argfix", async (_m, sendOpts, emit) => {
          const tool = (sendOpts?.local?.customTools as CT)["read"]!;
          // 1st attempt: un-repairable wrong key. Gateway must answer with an error result instead of surfacing a tool call.
          results.push(await tool.execute({ unmappedFoo: "bar" }, { toolCallId: "sdk1" }));
          // 2nd attempt: model corrected itself. This one is the only call the client should see.
          results.push(await tool.execute({ filePath: "/etc/hostname" }, { toolCallId: "sdk2" }));
          emit({ type: "assistant", agent_id: "argfix", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
        })
    });
    const tools = [{
      type: "function",
      function: { name: "read", description: "d", parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } }
    }];
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "read it" }], tools })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { choices: Array<{ message: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }> };
    const calls = body.choices[0]!.message.tool_calls ?? [];
    assert.equal(calls.length, 1, "only the corrected call reaches the client");
    assert.deepEqual(JSON.parse(calls[0]!.function.arguments), { filePath: "/etc/hostname" });
    const first = results[0] as { isError?: boolean; content: Array<{ text: string }> };
    assert.equal(first.isError, true);
    assert.match(first.content[0]!.text, /"filePath" is missing/);
    assert.match(first.content[0]!.text, /Unrecognized key: "unmappedFoo"/);
  });

  it("forwards a repeatedly invalid call after one bounce so the client's own validation stays authoritative", async () => {
    type CT = Record<string, { execute: (a: Record<string, unknown>, c: { toolCallId: string }) => Promise<unknown> }>;
    let bounced = 0;
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("stubborn", async (_m, sendOpts, emit) => {
          const tool = (sendOpts?.local?.customTools as CT)["read"]!;
          const r1 = (await tool.execute({}, { toolCallId: "s1" })) as { isError?: boolean };
          if (r1.isError) bounced++;
          void tool.execute({}, { toolCallId: "s2" }).catch(() => undefined); // parked: settles only when the client answers or the server shuts down
          emit({ type: "tool_call", agent_id: "stubborn", run_id: "r1", call_id: "s2", name: "read", status: "running" } as never);
        })
    });
    const tools = [{
      type: "function",
      function: { name: "read", description: "d", parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } }
    }];
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "read it" }], tools })
    });
    const body = (await res.json()) as { choices: Array<{ message: { tool_calls?: Array<{ function: { arguments: string } }> } }> };
    assert.equal(bounced, 1, "exactly one bounce per tool");
    assert.deepEqual(JSON.parse(body.choices[0]!.message.tool_calls![0]!.function.arguments), {}, "second invalid call is forwarded untouched");
  });

  it("long session with dozens of client tools: valid calls are never bounced, same-named tools keep their own schema, and tool errors from the client are retryable", async () => {
    type CT = Record<string, { execute: (a: Record<string, unknown>, c: { toolCallId: string }) => Promise<unknown> }>;
    const names = Array.from({ length: 40 }, (_, i) => `tool_${i}`);
    const seenTools: string[][] = [];
    const bounces: string[] = [];
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("long", async (_m, sendOpts, emit) => {
          const custom = sendOpts?.local?.customTools as CT;
          seenTools.push(Object.keys(custom));
          // Every tool with a valid payload must go straight through to the client (no bounce).
          const out = (await custom["read"]!.execute({ filePath: "/x" }, { toolCallId: "sdkA" })) as unknown;
          if (typeof out === "object" && out && (out as { isError?: boolean }).isError) bounces.push("read");
          emit({ type: "assistant", agent_id: "long", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: `got:${typeof out === "string" ? out : "obj"}` }] } });
        })
    });
    const tools = [
      { type: "function", function: { name: "read", description: "d", parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } } },
      ...names.map((n) => ({ type: "function", function: { name: n, description: "d", parameters: { type: "object", properties: { v: { type: "string" } }, required: ["v"] } } }))
    ];
    const post = (messages: unknown[]) =>
      fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "grok-4.6", messages, tools })
      }).then((r) => r.json() as Promise<{ choices: Array<{ message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> }>);

    // Build a long history: 30 earlier tool round trips, the last one an error reported by the client.
    const history: unknown[] = [{ role: "user", content: "start" }];
    for (let i = 0; i < 30; i++) {
      history.push({ role: "assistant", content: null, tool_calls: [{ id: `old_${i}`, type: "function", function: { name: `tool_${i % 40}`, arguments: JSON.stringify({ v: `x${i}` }) } }] });
      history.push({ role: "tool", tool_call_id: `old_${i}`, content: i === 29 ? "The tool_29 tool was called with invalid arguments: filePath missing" : `ok ${i}` });
    }
    history.push({ role: "user", content: "now read /x" });

    const first = await post(history);
    const call = first.choices[0]!.message.tool_calls![0]!;
    assert.equal(call.function.name, "read");
    assert.deepEqual(JSON.parse(call.function.arguments), { filePath: "/x" });
    assert.deepEqual(bounces, [], "valid args never bounced");
    assert.equal(seenTools[0]!.length, 41, "all 41 client tools exposed to the agent");

    const second = await post([...history, { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: "file contents" }]);
    assert.match(second.choices[0]!.message.content ?? "", /got:file contents/);
  });

  it("respects MAX_PARKED_RUNS=0 by immediately disposing parked runs and respects TRUST_PROXY=off on admin routes", async () => {
    let disposedCount = 0;
    const baseUrl = await startServer({
      config: makeTestConfig({ maxParkedRuns: 0, trustProxy: "off" }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () => {
        const agent = createFakeAgent("nopark", async (_m, sendOpts, emit) => {
          const tool = (sendOpts?.local?.customTools as Record<string, { execute: (a: Record<string, unknown>, c: { toolCallId: string }) => Promise<unknown> }>)["ping"];
          void tool?.execute({}, { toolCallId: "p1" }).catch(() => undefined);
          emit({ type: "tool_call", agent_id: "nopark", run_id: "r1", call_id: "p1", name: "ping", status: "running" } as never);
        });
        const origDispose = agent[Symbol.asyncDispose].bind(agent);
        agent[Symbol.asyncDispose] = async () => {
          disposedCount++;
          await origDispose();
        };
        return agent;
      }
    });
    const tools = [{ type: "function", function: { name: "ping", description: "p", parameters: { type: "object", properties: {} } } }];
    const r = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }], tools })
    });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 20));
    assert.ok(disposedCount >= 1, "agent must be disposed immediately when MAX_PARKED_RUNS=0");

    // With TRUST_PROXY=off, spoofed X-Forwarded-For must be ignored on admin Bearer auth throttling
    for (let i = 0; i < 8; i++) {
      await fetch(`${baseUrl}/v1/admin/overview`, {
        headers: { Authorization: "Bearer wrong-admin-pwd", "X-Forwarded-For": `203.0.113.${i + 10}` }
      });
    }
    const locked = await fetch(`${baseUrl}/v1/admin/overview`, {
      headers: { Authorization: "Bearer wrong-admin-pwd", "X-Forwarded-For": "203.0.113.99" }
    });
    assert.equal(locked.status, 429, "spoofed XFF must not bypass admin Bearer throttle when TRUST_PROXY=off");
  });

  it("hot-toggles allowNativeWebTools via /v1/admin/settings without restart and defaults to false", async () => {
    const seenToolLists: Array<string[] | undefined> = [];
    const baseUrl = await startServer({
      config: makeTestConfig({ allowNativeWebTools: false }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async (opts) => {
        seenToolLists.push(opts.tools as string[] | undefined);
        return createFakeAgent("web", async (_m, _s, emit) => {
          emit({ type: "assistant", agent_id: "web", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
        });
      }
    });

    const reqBody = JSON.stringify({
      model: "grok-4.6",
      messages: [{ role: "user", content: "search" }],
      tools: [{ type: "web_search" }]
    });
    const chat = () =>
      fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
        body: reqBody
      });

    assert.equal((await chat()).status, 200);
    assert.deepEqual(seenToolLists[0], [], "native webSearch must stay disabled when allowNativeWebTools=false");

    const toggleOn = await fetch(`${baseUrl}/v1/admin/settings`, {
      method: "POST",
      headers: { Authorization: "Bearer admin-secret-password", "Content-Type": "application/json" },
      body: JSON.stringify({ allowNativeWebTools: true })
    });
    assert.equal(toggleOn.status, 200);
    const toggleJson = (await toggleOn.json()) as { settings: { allowNativeWebTools?: boolean } };
    assert.equal(toggleJson.settings.allowNativeWebTools, true);

    assert.equal((await chat()).status, 200);
    assert.ok(seenToolLists[1]?.includes("webSearch"), "native webSearch must take effect immediately after hot-toggle");
  });

  it("survives malformed request targets and throttles admin brute force per IP", async () => {
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS
    });
    const u = new URL(baseUrl);
    const raw = (target: string, extra = "") =>
      new Promise<string>((resolve) => {
        const s = net.connect(Number(u.port), u.hostname, () =>
          s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\n${extra}Connection: close\r\n\r\n`)
        );
        let d = "";
        s.on("data", (x) => (d += x));
        s.on("close", () => resolve(d.split("\r\n")[0] ?? ""));
        s.on("error", () => resolve("ERR"));
      });
    for (const t of ["//[", "//a:b@[::1", "/%"]) {
      assert.match(await raw(t), /HTTP\/1\.1 (4\d\d)/, `malformed target ${t} must get a 4xx, not a crash`);
    }
    assert.match(await raw("/v1/models"), /HTTP\/1\.1 401/, "server still alive after malformed requests");

    const login = (pw: string, ip: string) =>
      fetch(`${baseUrl}/v1/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ password: pw })
      });
    for (let i = 0; i < 8; i++) assert.equal((await login(`bad${i}`, "203.0.113.7")).status, 401);
    const blocked = await login("admin-secret-password", "203.0.113.7");
    assert.equal(blocked.status, 429, "correct password is also refused while the IP is locked out");
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal((await login("admin-secret-password", "198.51.100.9")).status, 200, "other IPs are unaffected");
  });

  it("supports native webSearch SDK tools", async () => {
    const capturedAgentTools: unknown[] = [];

    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async (opts: AgentOptions) => {
        capturedAgentTools.push(opts.tools);
        return createFakeAgent("ws", async (_m, _s, emit) => {
          emit({
            type: "assistant",
            agent_id: "ws",
            run_id: "r1",
            message: { role: "assistant", content: [{ type: "text", text: "searched-ok" }] }
          });
        });
      }
    });

    // 1. Native `web_search` tool in OpenAI request activates @cursor/sdk `webSearch` + `webFetch`!
    const wsRes = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.6",
        input: "Latest news",
        tools: [{ type: "web_search_preview" }]
      })
    });
    assert.equal(wsRes.status, 200);
    assert.deepEqual(capturedAgentTools[0], ["webSearch", "webFetch"]);
  });

  it("rejects non-http(s) image URLs, missing model, and uses official error types / 405 / Retry-After", async () => {
    const H = { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" };
    const baseUrl = await startServer({ config: makeTestConfig(), modelListFetcher: async () => MOCK_MODELS, agentFactory: (async () => { throw new Error("must not run"); }) as never });
    const post = (path: string, body: unknown, h: Record<string, string> = H) =>
      fetch(`${baseUrl}${path}`, { method: "POST", headers: h, body: JSON.stringify(body) });

    for (const url of ["file:///etc/passwd", "ftp://x/y.png", "gopher://x", "javascript:alert(1)", "not a url"]) {
      const r = await post("/v1/chat/completions", { model: "grok-4.6", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }] });
      assert.equal(r.status, 400, url);
      const j = (await r.json()) as { error: { type: string } };
      assert.equal(j.error.type, "invalid_request_error");
    }
    const a = await post("/v1/messages", { model: "grok-4.6", max_tokens: 8, messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "file:///etc/passwd" } }] }] });
    assert.equal(a.status, 400);

    const noModel = await post("/v1/chat/completions", { messages: [{ role: "user", content: "hi" }] });
    assert.equal(noModel.status, 400);
    assert.equal(((await noModel.json()) as { error: { param: string } }).error.param, "model");

    const unauth = await post("/v1/chat/completions", {}, { "Content-Type": "application/json" });
    assert.equal(unauth.status, 401);
    assert.equal(((await unauth.json()) as { error: { type: string } }).error.type, "authentication_error");

    const m405 = await fetch(`${baseUrl}/v1/chat/completions`, { method: "GET", headers: H });
    assert.equal(m405.status, 405);
    assert.equal(m405.headers.get("allow"), "POST, OPTIONS");
    const d405 = await fetch(`${baseUrl}/v1/models`, { method: "DELETE", headers: H });
    assert.equal(d405.status, 405);
    const nf = await fetch(`${baseUrl}/v1/nope`, { headers: H });
    assert.equal(nf.status, 404);

    // Anthropic-shaped catalog
    const am = await fetch(`${baseUrl}/v1/models`, { headers: { "x-api-key": "gw-secret-token", "anthropic-version": "2023-06-01" } });
    assert.equal(am.status, 200);
    const amj = (await am.json()) as { data: Array<{ type: string; id: string; display_name: string }>; has_more: boolean };
    assert.equal(amj.has_more, false);
    assert.equal(amj.data[0]!.type, "model");
    assert.ok(amj.data.some((m) => m.id === "grok-4.6"));
    const om = (await (await fetch(`${baseUrl}/v1/models`, { headers: H })).json()) as { object: string };
    assert.equal(om.object, "list");

    // Variant ids resolve on GET too
    const v = await fetch(`${baseUrl}/v1/models/${encodeURIComponent("grok-4.6[fast=true,effort=low]")}`, { headers: H });
    assert.equal(v.status, 200);
    const unknown = await fetch(`${baseUrl}/v1/models/no-such-model`, { headers: H });
    assert.equal(unknown.status, 404);
    assert.equal(((await unknown.json()) as { error: { type: string } }).error.type, "invalid_request_error");
  });

  it("never falls back to gateway tokens as admin password and counts bearer probing separately", async () => {
    const { AdminAuthManager } = await import("../src/web/admin-auth.js");
    const noPw = new AdminAuthManager({ adminPassword: undefined, gatewayTokens: new Set(["gw-secret-token"]), envFilePath: undefined });
    assert.equal(noPw.isPasswordConfigured(), false);
    assert.throws(() => noPw.verifyPasswordAndIssueSession("gw-secret-token", "1.1.1.1"), /disabled/);
    const fakeReq = { headers: {}, socket: { remoteAddress: "9.9.9.9" } } as never;
    assert.throws(() => noPw.requireAdminAuth(fakeReq, "gw-secret-token"), /disabled/);

    const withPw = new AdminAuthManager({ adminPassword: "admin-secret-password", envFilePath: undefined });
    for (let i = 0; i < 20; i++) {
      assert.throws(() => withPw.requireAdminAuth(fakeReq, "client-token"), /administrator credentials|Too many/);
    }
    // Login form still works from the same IP: client-key probing did not lock it.
    const issued = withPw.verifyPasswordAndIssueSession("admin-secret-password", "9.9.9.9");
    assert.ok(issued.token.startsWith("adm_"));
  });

  it("charges a flat per-image token estimate instead of counting base64 bytes", async () => {
    const baseUrl = await startServer({ config: makeTestConfig(), modelListFetcher: async () => MOCK_MODELS });
    const count = async (data: string, nested = false) => {
      const imageBlock = { type: "image", source: { type: "base64", media_type: "image/png", data } };
      const content = nested
        ? [{ type: "tool_result", tool_use_id: "t1", content: [imageBlock] }]
        : [{ type: "text", text: "hi" }, imageBlock];
      const res = await fetch(`${baseUrl}/v1/messages/count_tokens`, {
        method: "POST",
        headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content }] })
      });
      assert.equal(res.status, 200);
      return ((await res.json()) as { input_tokens: number }).input_tokens;
    };
    const small = await count("A".repeat(100));
    const huge = await count("A".repeat(2_000_000));
    assert.equal(huge, small, "image payload size must not change the estimate");
    assert.ok(huge >= 1200 && huge < 1400, `flat estimate expected, got ${huge}`);
    const nested = await count("A".repeat(2_000_000), true);
    assert.ok(nested < 1500, `nested tool_result image must be flat too, got ${nested}`);
    const noImage = await (await fetch(`${baseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }] })
    })).json() as { input_tokens: number };
    assert.ok(noImage.input_tokens < 50);
  });

  it("returns Retry-After on api key quota 429", async () => {
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("rq", async (_m, _s, emit) => {
          emit({ type: "assistant", agent_id: "rq", run_id: "r", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
        })
    });
    const login = await fetch(`${baseUrl}/v1/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "admin-secret-password" }) });
    const tok = ((await login.json()) as { token?: string }).token;
    assert.ok(tok, "admin login must return a session token");
    const AH = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
    const created = await fetch(`${baseUrl}/v1/admin/client-keys`, { method: "POST", headers: AH, body: JSON.stringify({ name: "quota-probe", maxRequests: 1 }) });
    assert.equal(created.status, 200);
    const rawToken = ((await created.json()) as { rawToken?: string }).rawToken;
    assert.ok(rawToken, "client key creation must return rawToken");
    const call = () => fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${rawToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "x" }] }) });
    assert.equal((await call()).status, 200);
    const limited = await call();
    assert.equal(limited.status, 429);
    assert.equal(((await limited.json()) as { error: { code: string; type: string } }).error.code, "api_key_quota_exceeded");
    assert.equal(limited.headers.get("retry-after"), "3600");
  });

  it("streams a spec-shaped Responses event sequence and handles json_schema / max_completion_tokens explicitly", async () => {
    const baseUrl = await startServer({
      config: makeTestConfig(),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("rs", async (_m, _s, emit) => {
          emit({ type: "thinking", agent_id: "rs", run_id: "r", text: "pondering" } as never);
          emit({ type: "assistant", agent_id: "rs", run_id: "r", message: { role: "assistant", content: [{ type: "text", text: "STREAM" }] } });
          emit({ type: "assistant", agent_id: "rs", run_id: "r", message: { role: "assistant", content: [{ type: "text", text: "\nOK" }] } });
        })
    });
    const H = { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" };
    const res = await fetch(`${baseUrl}/v1/responses`, { method: "POST", headers: H, body: JSON.stringify({ model: "grok-4.6", input: "hi", stream: true }) });
    assert.equal(res.status, 200);
    const raw = await res.text();
    const frames = raw.split("\n\n").filter(Boolean).map((f) => {
      const ev = /^event: (.+)$/m.exec(f)![1]!;
      return { ev, data: JSON.parse(/^data: (.+)$/m.exec(f)![1]!) as Record<string, any> };
    });
    const names = frames.map((f) => f.ev);
    const order = [
      "response.created", "response.in_progress",
      "response.output_item.added", "response.reasoning_summary_part.added", "response.reasoning_summary_text.delta",
      "response.reasoning_summary_text.done", "response.reasoning_summary_part.done", "response.output_item.done",
      "response.output_item.added", "response.content_part.added", "response.output_text.delta",
      "response.output_text.done", "response.content_part.done", "response.output_item.done",
      "response.completed"
    ];
    let cursor = -1;
    for (const want of order) {
      const at = names.indexOf(want, cursor + 1);
      assert.ok(at > cursor, `missing or out-of-order ${want} in ${names.join(",")}`);
      cursor = at;
    }
    frames.forEach((f, idx) => {
      assert.equal(f.data.type, f.ev, "data.type must mirror the event name");
      assert.equal(f.data.sequence_number, idx, "sequence_number must be monotonic");
    });
    const done = frames.find((f) => f.ev === "response.output_text.done")!.data;
    assert.equal(done.text, "STREAM\nOK");
    assert.equal(done.output_index, 1);
    const completed = frames[frames.length - 1]!.data.response;
    assert.equal(completed.status, "completed");
    assert.equal(completed.output.length, 2);
    assert.equal(completed.output[0].type, "reasoning");
    assert.equal(completed.output[1].content[0].text, "STREAM\nOK");
    assert.equal(completed.output_text, "STREAM\nOK");

    // explicit structured-option handling
    const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
    const schema = { type: "json_schema", json_schema: { name: "x", schema: { type: "object" } } };
    const a = await post("/v1/chat/completions", { model: "grok-4.6", messages: [{ role: "user", content: "hi" }], response_format: schema });
    assert.equal(a.status, 400);
    const aj = (await a.json()) as { error: { code: string; param: string; type: string; message: string } };
    assert.equal(aj.error.code, "unsupported_parameter");
    assert.equal(aj.error.param, "response_format");
    assert.equal(aj.error.type, "invalid_request_error");
    assert.match(aj.error.message, /JSON Schema/);

    const b = await post("/v1/responses", { model: "grok-4.6", input: "hi", text: { format: { type: "json_schema", name: "x", schema: {} } } });
    assert.equal(b.status, 400);
    assert.equal(((await b.json()) as { error: { param: string } }).error.param, "text.format");

    const ok = await post("/v1/chat/completions", { model: "grok-4.6", messages: [{ role: "user", content: "hi" }], max_completion_tokens: 50, n: 1 });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-gateway-ignored-params"), "max_completion_tokens");
    for (const bad of [0, -3, 1.5, "10"]) {
      const r = await post("/v1/chat/completions", { model: "grok-4.6", messages: [{ role: "user", content: "hi" }], max_completion_tokens: bad });
      assert.equal(r.status, 400, String(bad));
    }
    const n0 = await post("/v1/chat/completions", { model: "grok-4.6", messages: [{ role: "user", content: "hi" }], n: 0 });
    assert.equal(n0.status, 400);
  });

  it("records client IP in traces and exposes Bot quota + on-demand toggle + sessionToken key creation", async () => {
    let onDemandOn = true;
    const calls: string[] = [];
    const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const upstream = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push(url.replace("https://api2.cursor.sh", ""));
      if (url.endsWith("/auth/exchange_user_api_key")) return jsonResp({ accessToken: "eyJ.access.tok", refreshToken: "r" });
      if (url.endsWith("/auth/usage-summary")) {
        return jsonResp({
          billingCycleEnd: "2099-01-01T00:00:00.000Z",
          membershipType: "pro",
          individualUsage: {
            plan: { enabled: true, used: 500, limit: 2000, remaining: 1500, autoPercentUsed: 10, apiPercentUsed: 20, totalPercentUsed: 15 },
            onDemand: onDemandOn ? { enabled: true, used: 100, limit: null, remaining: null } : { enabled: false, used: 100, limit: 0, remaining: 0 }
          }
        });
      }
      if (url.endsWith("/GetSandUsageStatus")) {
        return jsonResp({ hasNonZeroIncludedLimit: true, usagePercent: 30, hasAvailableUsage: true, currentPeriodStart: "2026-11-12T00:00:00Z" });
      }
      if (url.endsWith("/SetHardLimit")) {
        const b = JSON.parse(String(init?.body)) as { noUsageBasedAllowed: boolean };
        onDemandOn = !b.noUsageBasedAllowed;
        return jsonResp({});
      }
      return jsonResp({ error: "unexpected " + url }, 404);
    }) as typeof fetch;

    const sessionCalls: Array<{ url: string; auth: string; body: string }> = [];
    const sessionFetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      sessionCalls.push({ url, auth: String((init?.headers as Record<string, string>).Authorization), body: String(init?.body) });
      if (url.endsWith("/ListUserApiKeys")) return jsonResp({ apiKeys: [{ id: 1, name: "old", maskedKey: "crsr_abcd...wxyz" }] });
      if (url.endsWith("/CreateUserApiKey")) return jsonResp({ apiKey: "crsr_created_key_000000000001" });
      return jsonResp({}, 404);
    }) as typeof fetch;

    const baseUrl = await startServer({
      config: makeTestConfig({ cursorApiKeys: ["crsr_admin_feature_key_0001"] }),
      modelListFetcher: async () => MOCK_MODELS,
      quotaHttpFetcher: upstream,
      meFetcher: async () => ({ apiKeyName: "k", userEmail: "a@b.c", userId: 1, createdAt: "2026-01-01T00:00:00Z" }),
      sessionRpcFetcher: sessionFetch,
      agentFactory: async () => createFakeAgent("ip", async (_m, _s, emit) => {
        emit({ type: "assistant", agent_id: "ip", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
      })
    });
    const admin = { Authorization: "Bearer admin-secret-password", "Content-Type": "application/json" };

    // trace carries the (proxy-supplied) client IP and the requested model
    const chat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json", "X-Forwarded-For": "9.9.9.9, 203.0.113.7", "User-Agent": "Kilo-Code/5.1.0" },
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(chat.status, 200);
    const logs = (await (await fetch(`${baseUrl}/v1/admin/logs`, { headers: admin })).json()) as { logs: Array<{ clientIp?: string; requestedModel: string; client?: string; userAgent?: string }> };
    assert.equal(logs.logs[0]!.clientIp, "203.0.113.7");
    assert.equal(logs.logs[0]!.client, "Kilo");
    assert.equal(logs.logs[0]!.userAgent, "Kilo-Code/5.1.0");
    const ov = (await (await fetch(`${baseUrl}/v1/admin/overview?range=today`, { headers: admin })).json()) as { recent: Array<{ client?: string; ua?: string }> };
    assert.equal(ov.recent[0]!.client, "Kilo");
    assert.equal(ov.recent[0]!.ua, "Kilo-Code/5.1.0");
    assert.equal(logs.logs[0]!.requestedModel, "grok-4.6");

    // Bot quota is surfaced on the pool slot after a forced sync
    const quota = (await (await fetch(`${baseUrl}/v1/quota?force=1`, { headers: admin })).json()) as {
      accounts: Array<{ bot?: { hasLimit: boolean; usedPercent: number; remainingPercent: number } }>;
      keyPool: { slots?: Array<{ slotId: string; bot?: { remainingPercent: number } }> } | Array<{ slotId: string; bot?: { remainingPercent: number } }>;
    };
    assert.equal(quota.accounts[0]!.bot?.usedPercent, 30, JSON.stringify(quota.accounts[0]));
    assert.equal(quota.accounts[0]!.bot?.remainingPercent, 70);
    const slots = Array.isArray(quota.keyPool) ? quota.keyPool : (quota.keyPool.slots ?? []);
    assert.equal(slots[0]!.bot?.remainingPercent, 70);

    // On-demand toggle writes via SetHardLimit and verifies by reading usage-summary back
    const slotId = slots[0]!.slotId;
    const off = await fetch(`${baseUrl}/v1/admin/keys/${slotId}/on-demand`, { method: "POST", headers: admin, body: JSON.stringify({ mode: "off" }) });
    assert.equal(off.status, 200);
    assert.equal(((await off.json()) as { onDemand: { enabled: boolean } }).onDemand.enabled, false);
    const on = await fetch(`${baseUrl}/v1/admin/keys/${slotId}/on-demand`, { method: "POST", headers: admin, body: JSON.stringify({ mode: "on" }) });
    assert.equal(((await on.json()) as { onDemand: { enabled: boolean } }).onDemand.enabled, true);
    const badMode = await fetch(`${baseUrl}/v1/admin/keys/${slotId}/on-demand`, { method: "POST", headers: admin, body: JSON.stringify({ mode: "maybe" }) });
    assert.equal(badMode.status, 400);
    const noSlot = await fetch(`${baseUrl}/v1/admin/keys/deadbeef/on-demand`, { method: "POST", headers: admin, body: JSON.stringify({ mode: "off" }) });
    assert.equal(noSlot.status, 404);

    // sessionToken: preview lists masked keys; create needs explicit confirm and never echoes the new key
    const cookieToken = "WorkosCursorSessionToken=user_01ABC%3A%3AeyJhbGciOi.payload.sig";
    const list = await fetch(`${baseUrl}/v1/admin/session-token/list-keys`, { method: "POST", headers: admin, body: JSON.stringify({ sessionToken: cookieToken }) });
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as { apiKeys: unknown[] }).apiKeys.length, 1);
    assert.equal(sessionCalls[0]!.auth, "Bearer eyJhbGciOi.payload.sig");

    const noConfirm = await fetch(`${baseUrl}/v1/admin/session-token/create-key`, { method: "POST", headers: admin, body: JSON.stringify({ sessionToken: cookieToken }) });
    assert.equal(noConfirm.status, 400);
    assert.equal(sessionCalls.filter((c) => c.url.endsWith("/CreateUserApiKey")).length, 0, "nothing created without confirm");

    const created = await fetch(`${baseUrl}/v1/admin/session-token/create-key`, { method: "POST", headers: admin, body: JSON.stringify({ sessionToken: cookieToken, confirm: true, name: "gw-new" }) });
    assert.equal(created.status, 200);
    const createdText = await created.text();
    assert.ok(!createdText.includes("crsr_created_key_000000000001"), "full key must not be echoed to the browser");
    const usage = (await (await fetch(`${baseUrl}/v1/usage`, { headers: admin })).json()) as { keyPool: unknown };
    assert.ok(JSON.stringify(usage.keyPool).includes("gw-new"), "new key is stored in the pool");

    const badToken = await fetch(`${baseUrl}/v1/admin/session-token/list-keys`, { method: "POST", headers: admin, body: JSON.stringify({ sessionToken: "not-a-token" }) });
    assert.equal(badToken.status, 400);
    assert.ok(calls.length > 0);
  });

  it("request log never holds conversation text (system, user, tool args/results, model output, thinking)", async () => {
    const baseUrl = await startServer({
      config: makeTestConfig({ cursorApiKeys: ["crsr_privacy_key_0001"] }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () => createFakeAgent("pv", async (_m, _s, emit) => {
        emit({ type: "thinking", agent_id: "pv", run_id: "r1", text: "SENTINEL_THINKING_77" } as never);
        emit({ type: "assistant", agent_id: "pv", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: "SENTINEL_OUTPUT_55" }] } });
      })
    });
    const admin = { Authorization: "Bearer admin-secret-password", "Content-Type": "application/json" };
    const chat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.6",
        messages: [
          { role: "system", content: "SENTINEL_SYSTEM_11" },
          { role: "user", content: "SENTINEL_USER_22" },
          { role: "assistant", content: "SENTINEL_ASSISTANT_33", tool_calls: [{ id: "call_1", type: "function", function: { name: "t", arguments: "{\"x\":\"SENTINEL_TOOLARG_44\"}" } }] },
          { role: "tool", tool_call_id: "call_1", content: "SENTINEL_TOOLRES_66" },
          { role: "user", content: "SENTINEL_LAST_88" }
        ]
      })
    });
    assert.equal(chat.status, 200);

    const listText = await (await fetch(`${baseUrl}/v1/admin/logs`, { headers: admin })).text();
    const list = JSON.parse(listText) as { logs: Array<{ id: string }> };
    assert.equal(list.logs.length, 1);
    const detailText = await (await fetch(`${baseUrl}/v1/admin/logs/${list.logs[0]!.id}`, { headers: admin })).text();
    const overviewText = await (await fetch(`${baseUrl}/v1/admin/overview?range=today`, { headers: admin })).text();
    for (const body of [listText, detailText, overviewText]) {
      assert.ok(!/SENTINEL_/.test(body), "conversation text leaked into admin API output");
    }
    const detail = JSON.parse(detailText) as { messageCount: number; fingerprint: { conversation?: string }; hasThinking: boolean };
    assert.equal(detail.messageCount, 5);
    assert.equal(detail.hasThinking, true);
  });

  it("rejects Anthropic missing max_tokens, oversized bodies, non-JSON Content-Type, and protocol auth floods", async () => {
    const captured: string[] = [];
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const baseUrl = await startServer({
      config: makeTestConfig({ maxBodyBytes: 1024 }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("qa", async (m, _s, emit) => {
          captured.push(typeof m === "string" ? m : m.text);
          emit({ type: "assistant", agent_id: "qa", run_id: "r", message: { role: "assistant", content: [{ type: "text", text: "red" }] } });
        })
    });
    const H = { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" };
    const post = (path: string, body: unknown, headers: Record<string, string> = H) =>
      fetch(`${baseUrl}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

    const missing = await post("/v1/messages", { model: "grok-4.6", messages: [{ role: "user", content: "hi" }] });
    assert.equal(missing.status, 400);
    const missingBody = (await missing.json()) as { error: { param?: string; message: string } };
    assert.match(missingBody.error.message, /max_tokens/);
    assert.equal(missingBody.error.param, "max_tokens");

    const okAnth = await post("/v1/messages", { model: "grok-4.6", max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
    assert.equal(okAnth.status, 200);

    const vision = await post("/v1/chat/completions", {
      model: "grok-4.6",
      messages: [{ role: "user", content: [{ type: "text", text: "color?" }, { type: "image_url", image_url: { url: tinyPng } }] }]
    });
    assert.equal(vision.status, 200);
    assert.match(captured[captured.length - 1]!, /Never emit tool XML/);

    const tooBig = await post("/v1/chat/completions", { model: "grok-4.6", messages: [{ role: "user", content: "x".repeat(2000) }] });
    assert.equal(tooBig.status, 413);
    assert.equal(((await tooBig.json()) as { error: { code: string } }).error.code, "request_too_large");

    const plain = await post("/v1/chat/completions", { model: "grok-4.6", messages: [{ role: "user", content: "hi" }] }, { ...H, "Content-Type": "text/plain" });
    assert.equal(plain.status, 415);

    const ip = "203.0.113.88";
    const bad = () => fetch(`${baseUrl}/v1/models`, { headers: { Authorization: "Bearer nope", "X-Forwarded-For": ip } });
    for (let i = 0; i < 8; i++) assert.equal((await bad()).status, 401);
    const blocked = await bad();
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    const sameIpGood = await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: "Bearer gw-secret-token", "X-Forwarded-For": ip } });
    assert.equal(sameIpGood.status, 200, "valid token must not be locked out by protocol auth floods");
    const otherIp = await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: "Bearer gw-secret-token", "X-Forwarded-For": "198.51.100.44" } });
    assert.equal(otherIp.status, 200);
  });

  it("blocks CSRF bypass via bogus Authorization, multibyte token 500 oracle, and malformed URI 500s", async () => {
    const baseUrl = await startServer({ config: makeTestConfig(), modelListFetcher: async () => MOCK_MODELS });
    const login = await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-secret-password" })
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;

    // Cookie + bogus Authorization header without X-Console-CSRF must NOT bypass auth/CSRF!
    const csrfBypass = await fetch(`${baseUrl}/v1/admin/affinity/clear`, {
      method: "POST",
      headers: { cookie, Authorization: "Bearer totally-bogus" }
    });
    assert.equal(csrfBypass.status, 401);

    // Multibyte UTF-16 length matching "gw-secret-token" (15 chars) must return 401, never 500 RangeError
    const multibyteRes = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${"é".repeat(15)}` }
    });
    assert.equal(multibyteRes.status, 401);

    // Malformed %E0%A4%A in cookie or model ID must never crash with 500
    const badCookie = await fetch(`${baseUrl}/v1/usage`, {
      headers: { Authorization: "Bearer admin-secret-password", Cookie: "cgw_admin_session=%E0%A4%A" }
    });
    assert.equal(badCookie.status, 200);
    const badModel = await fetch(`${baseUrl}/v1/models/%E0%A4%A`, {
      headers: { Authorization: "Bearer gw-secret-token" }
    });
    assert.equal(badModel.status, 400);
  });

  it("surfaces real 429 pre-stream on Anthropic & Responses SSE, gates Chat usage chunk, and reuses Warm pool in Responses", async () => {
    let failNext = true;
    let sendCount = 0;
    const baseUrl = await startServer({
      config: makeTestConfig({ keyCooldownMs: 10 }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () => {
        if (failNext) throw new RateLimitError("upstream 429");
        return createFakeAgent("wresp", async (_m, _s, emit) => {
          sendCount += 1;
          emit({ type: "assistant", agent_id: "wresp", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
        });
      }
    });
    const H = { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" };

    // Pre-stream 429 on /v1/messages & /v1/responses stream=true must return HTTP 429, not 200
    const anth429 = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ model: "grok-4.6", max_tokens: 16, stream: true, messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(anth429.status, 429);

    const resp429 = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ model: "grok-4.6", stream: true, input: "hi" })
    });
    assert.equal(resp429.status, 429);

    failNext = false;
    await new Promise((r) => setTimeout(r, 20));

    // Chat SSE without stream_options.include_usage must NOT emit trailing choices: [] chunk
    const chatSse = await (await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ model: "grok-4.6", stream: true, messages: [{ role: "user", content: "hi" }] })
    })).text();
    const chatFrames = chatSse.split("\n\n").filter((f) => f.startsWith("data: ") && f !== "data: [DONE]").map((f) => JSON.parse(f.slice(6)));
    assert.ok(chatFrames.every((f) => Array.isArray(f.choices) && f.choices.length > 0));

    // /v1/responses multi-turn pure text reuses WarmAgentPool & accepts web_search_call history items
    const r1 = await (await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ model: "grok-4.6", input: [{ role: "user", content: "turn1" }] })
    })).json() as { output_text: string };
    const beforeWarm = sendCount;
    const r2 = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        model: "grok-4.6",
        input: [
          { role: "user", content: "turn1" },
          { type: "web_search_call", id: "ws_1" },
          { role: "assistant", content: [{ type: "output_text", text: r1.output_text }] },
          { role: "user", content: "turn2" }
        ]
      })
    });
    assert.equal(r2.status, 200);
    assert.equal(sendCount, beforeWarm + 1, "turn2 on /v1/responses should reuse the warm agent");
  });

  it("atomically enforces sub-key maxRequests under concurrent burst and prevents parallel tool split deadlock", async () => {
    const baseUrl = await startServer({
      config: makeTestConfig({ toolBatchGraceMs: 15, runIdleTimeoutMs: 600 }),
      modelListFetcher: async () => MOCK_MODELS,
      agentFactory: async () =>
        createFakeAgent("par", async (_m, sendOpts, emit) => {
          const tools = (sendOpts?.local?.customTools ?? {}) as Record<string, { execute: (a: Record<string, never>, c: { toolCallId: string }) => Promise<unknown> }>;
          const names = Object.keys(tools);
          if (names.length >= 2) {
            const p1 = tools[names[0]!]!.execute({}, { toolCallId: "tc1" });
            await new Promise((r) => setTimeout(r, 45)); // > 15ms grace
            const p2 = tools[names[1]!]!.execute({}, { toolCallId: "tc2" });
            await Promise.all([p1, p2]);
          } else {
            await new Promise((r) => setTimeout(r, 25));
          }
          emit({ type: "assistant", agent_id: "par", run_id: "r1", message: { role: "assistant", content: [{ type: "text", text: "all-done" }] } });
        })
    });

    const createRes = await (await fetch(`${baseUrl}/v1/admin/client-keys`, {
      method: "POST",
      headers: { Authorization: "Bearer admin-secret-password", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "atomic-1", maxRequests: 1 })
    })).json() as { rawToken: string };

    const burst = await Promise.all([1, 2, 3].map((i) =>
      fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${createRes.rawToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: `b${i}` }] })
      }).then((r) => r.status)
    ));
    assert.deepEqual(burst.sort(), [200, 429, 429]);

    // Parallel tool split: t1 arrives first, t2 arrives 45ms later while parked; resuming t1 must flush t2 instead of 504!
    const H = { Authorization: "Bearer gw-secret-token", "Content-Type": "application/json" };
    const tools = [
      { type: "function", function: { name: "t1", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "t2", parameters: { type: "object", properties: {} } } }
    ];
    const t1Res = await (await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ model: "grok-4.6", messages: [{ role: "user", content: "go" }], tools })
    })).json() as { choices: Array<{ message: { tool_calls: Array<{ id: string }> } }> };
    await new Promise((r) => setTimeout(r, 70));
    const t2Res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        model: "grok-4.6",
        messages: [
          { role: "user", content: "go" },
          t1Res.choices[0]!.message,
          { role: "tool", tool_call_id: t1Res.choices[0]!.message.tool_calls[0]!.id, content: "r1" }
        ],
        tools
      })
    });
    assert.equal(t2Res.status, 200);
    const t2Body = await t2Res.json() as { choices: Array<{ message: { tool_calls?: Array<{ id: string }> } }> };
    assert.equal(t2Body.choices[0]!.message.tool_calls?.length, 1);
  });

  it("localizes admin backend errors via X-Console-Lang / Accept-Language and serves bilingual console UI", async () => {
    const baseUrl = await startServer({ config: makeTestConfig(), modelListFetcher: async () => MOCK_MODELS });

    const enBad = await (await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Console-Lang": "en" },
      body: JSON.stringify({ password: "wrong-password" })
    })).json() as { error: { message: string } };
    assert.equal(enBad.error.message, "Invalid admin password.");

    const zhBad = await (await fetch(`${baseUrl}/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Console-Lang": "zh" },
      body: JSON.stringify({ password: "wrong-password" })
    })).json() as { error: { message: string } };
    assert.equal(zhBad.error.message, "管理密码错误。");

    const html = await (await fetch(`${baseUrl}/dashboard`)).text();
    assert.match(html, /id="langToggleBtn"/);
    assert.match(html, /id="loginLangBtn"/);
    assert.match(html, /X-Console-Lang/);
  });
});
