import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { UsageLedger, type LedgerRecord } from "../src/services/usage-ledger.js";

const rec = (over: Partial<LedgerRecord> = {}): LedgerRecord => ({
  at: Date.now(),
  model: "grok-4.6",
  key: "team-a",
  ip: "203.0.113.7",
  account: "acct-1",
  ok: true,
  status: 200,
  durationMs: 1200,
  protocol: "openai",
  stream: true,
  inputTokens: 100,
  cacheReadTokens: 300,
  outputTokens: 50,
  ...over
});

describe("usage ledger", () => {
  it("aggregates by model / key / ip and computes cache hit rate", () => {
    const l = new UsageLedger(undefined);
    l.record(rec());
    l.record(rec({ ip: "198.51.100.2", model: "claude-4", inputTokens: 1000, cacheReadTokens: 0, outputTokens: 10 }));
    l.record(rec({ ok: false, status: 502, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }));
    const o = l.overview("today");
    assert.equal(o.totals.requests, 3);
    assert.equal(o.totals.errors, 1);
    assert.equal(o.byModel[0]!.name, "claude-4");
    assert.equal(o.byIp[0]!.name, "198.51.100.2");
    assert.equal(o.byKey[0]!.requests, 3);
    assert.equal(o.totals.cacheHitRatePercent, Number(((300 / 1400) * 100).toFixed(1)));
    assert.equal(o.recent.length, 3);
    assert.ok(o.trend.some((p) => p.requests > 0));
  });

  it("excludes data outside the range", () => {
    const l = new UsageLedger(undefined);
    l.record(rec({ at: Date.now() - 10 * 24 * 3_600_000 }));
    assert.equal(l.overview("7d").totals.requests, 0);
    assert.equal(l.overview("30d").totals.requests, 1);
  });

  it("persists metadata only and reloads it", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "ledger-")), "usage-ledger.json");
    const a = new UsageLedger(file);
    a.record(rec());
    a.flush();
    const raw = readFileSync(file, "utf8");
    assert.ok(!/prompt|content|message|secret/i.test(raw));
    const b = new UsageLedger(file);
    assert.equal(b.overview("today").totals.requests, 1);
  });

  it("drops the IP when recording is switched off", () => {
    const l = new UsageLedger(undefined, false);
    l.record(rec());
    const o = l.overview("today");
    assert.equal(o.byIp[0]!.name, "-");
    assert.equal(o.recent[0]!.ip, "-");
  });
});
