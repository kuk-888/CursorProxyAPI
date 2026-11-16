import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyClient, sanitizeUserAgent } from "../src/utils/user-agent.js";

describe("user agent helpers", () => {
  it("classifies common coding clients", () => {
    assert.equal(classifyClient("Kilo-Code/5.1.0"), "Kilo");
    assert.equal(classifyClient("claude-cli/2.0.1 (external, cli)"), "Claude Code");
    assert.equal(classifyClient("RooCode/3.2"), "Roo Code");
    assert.equal(classifyClient("OpenAI/JS 4.52.0"), "OpenAI SDK");
    assert.equal(classifyClient("curl/8.4.0"), "curl");
    assert.equal(classifyClient("Mozilla/5.0 (Macintosh)"), "Browser");
    assert.equal(classifyClient(""), "unknown");
    assert.equal(classifyClient("SomethingElse/1"), "other");
  });

  it("strips control chars and caps length", () => {
    assert.equal(sanitizeUserAgent("a\r\nb\u0000c"), "a  b c");
    assert.equal(sanitizeUserAgent("x".repeat(500)).length, 160);
    assert.equal(sanitizeUserAgent(undefined), "");
    assert.equal(sanitizeUserAgent(["first", "second"]), "first");
  });
});
