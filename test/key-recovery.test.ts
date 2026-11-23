import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UpstreamKeyPool } from "../src/core/key-pool.js";

const KEY = "crsr_" + "a".repeat(40);
const mk = (extra: Record<string, unknown> = {}) =>
  new UpstreamKeyPool({
    cursorApiKeys: [KEY],
    disabledCursorApiKeys: [],
    keyLabels: {},
    keyAutoDisabled: {},
    lbStrategy: "round-robin",
    sessionAffinityEnabled: false,
    sessionAffinityTtlMs: 1000,
    autoDisableExhaustedKeys: true,
    keyCooldownMs: 1000,
    envFilePath: undefined,
    ...extra
  } as never);

const quota = (auto: number, api: number, od: boolean, end?: string) =>
  ({
    membershipType: "pro",
    ...(end ? { billingCycleEnd: end } : {}),
    cursorModelsAutoPool: { usedPercent: 100 - auto, remainingPercent: auto },
    premiumApiPool: { usedPercent: 100 - api, remainingPercent: api },
    overallIncludedPlan: { usedPercent: null, remainingPercent: null, allowanceUsd: null },
    onDemandSpend: { enabled: od }
  }) as never;

describe("key auto-disable recovery", () => {
  it("separates quota trips from auth trips and heals quota trips on fresh telemetry", () => {
    const pool = mk();
    pool.updateSlotQuotaCache(KEY, undefined, quota(0, 0, false, new Date(Date.now() + 86_400_000).toISOString()));
    let s = pool.statusSnapshot()[0]!;
    assert.equal(s.enabled, false);
    assert.equal(s.autoDisabledKind, "quota");
    assert.ok(s.autoRecoverAt);
    assert.deepEqual(pool.recoveryProbeKeys(), [KEY]);

    pool.updateSlotQuotaCache(KEY, undefined, quota(0, 0, false, new Date(Date.now() + 86_400_000).toISOString()));
    assert.equal(pool.statusSnapshot()[0]!.enabled, false);

    pool.updateSlotQuotaCache(KEY, undefined, quota(40, 40, false));
    s = pool.statusSnapshot()[0]!;
    assert.equal(s.enabled, true);
    assert.equal(s.autoDisabledKind, undefined);
  });

  it("does not auto-heal auth trips but recheck re-enables them", () => {
    const pool = mk();
    pool.reportAuthFailure(KEY, "HTTP 401");
    let s = pool.statusSnapshot()[0]!;
    assert.equal(s.autoDisabledKind, "auth");
    assert.deepEqual(pool.recoveryProbeKeys(), []);
    pool.updateSlotQuotaCache(KEY, undefined, quota(50, 50, false));
    assert.equal(pool.statusSnapshot()[0]!.enabled, false);
    pool.recheckSlot(s.slotId);
    s = pool.statusSnapshot()[0]!;
    assert.equal(s.enabled, true);
  });

  it("restores the persisted trip state after a restart", () => {
    const pool = mk({
      cursorApiKeys: [],
      disabledCursorApiKeys: [KEY],
      keyAutoDisabled: {}
    });
    const id = pool.statusSnapshot()[0]!.slotId;
    const again = mk({
      cursorApiKeys: [],
      disabledCursorApiKeys: [KEY],
      keyAutoDisabled: { [id]: { kind: "quota", reason: "x", resetAtMs: Date.now() + 5000 } }
    });
    const s = again.statusSnapshot()[0]!;
    assert.equal(s.autoDisabledKind, "quota");
    assert.ok(s.autoRecoverAt);
  });
});
