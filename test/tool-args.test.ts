import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findToolArgsProblem, formatToolArgsError, repairToolArgs } from "../src/core/tool-args.js";

const readSchema = {
  type: "object",
  properties: { filePath: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } },
  required: ["filePath"]
};

describe("findToolArgsProblem", () => {
  it("accepts valid args and schemas without `required`", () => {
    assert.equal(findToolArgsProblem(readSchema, { filePath: "/a" }), null);
    assert.equal(findToolArgsProblem({ type: "object", properties: {} }, {}), null);
    assert.equal(findToolArgsProblem({ type: "object", required: [] }, {}), null);
  });

  it("flags missing and null required fields, and reports mis-named keys", () => {
    assert.deepEqual(findToolArgsProblem(readSchema, {})?.missing, ["filePath"]);
    assert.deepEqual(findToolArgsProblem(readSchema, { filePath: null })?.missing, ["filePath"]);
    const p = findToolArgsProblem(readSchema, { path: "/a" })!;
    assert.deepEqual(p.missing, ["filePath"]);
    assert.deepEqual(p.unexpected, ["path"]);
    assert.deepEqual(p.declared, ["filePath", "offset", "limit"]);
  });

  it("treats falsy-but-present values as present (empty string, 0, false)", () => {
    const schema = { type: "object", properties: { a: {}, b: {}, c: {} }, required: ["a", "b", "c"] };
    assert.equal(findToolArgsProblem(schema, { a: "", b: 0, c: false }), null);
  });

  it("ignores malformed `required` entries and never throws on odd schemas", () => {
    assert.equal(findToolArgsProblem({ required: "filePath" } as never, {}), null);
    assert.equal(findToolArgsProblem({ required: [1, null, ""] } as never, {}), null);
    assert.deepEqual(findToolArgsProblem({ required: ["x"] }, {})?.declared, []);
    assert.equal(findToolArgsProblem(null as never, {}), null);
    assert.equal(findToolArgsProblem(readSchema, null as never), null);
  });

  it("formats an actionable message without echoing argument values", () => {
    const msg = formatToolArgsError("read", findToolArgsProblem(readSchema, { path: "/secret/value" })!);
    assert.match(msg, /"filePath" is missing/);
    assert.match(msg, /Unrecognized key: "path"/);
    assert.match(msg, /Accepted properties: filePath, offset, limit/);
    assert.ok(!msg.includes("/secret/value"));
  });
});

describe("repairToolArgs", () => {
  it("auto-repairs path and file_path to required filePath", () => {
    assert.deepEqual(repairToolArgs(readSchema, { path: "/etc/hosts" }).filePath, "/etc/hosts");
    assert.deepEqual(repairToolArgs(readSchema, { file_path: "/etc/hosts" }).filePath, "/etc/hosts");
    assert.deepEqual(repairToolArgs(readSchema, { filepath: "/etc/hosts" }).filePath, "/etc/hosts");
    assert.deepEqual(repairToolArgs(readSchema, { filename: "/etc/hosts" }).filePath, "/etc/hosts");
  });

  it("unnests arguments or args when wrapped in an extra MCP envelope", () => {
    const wrapped = { arguments: { filePath: "/etc/passwd" } };
    assert.deepEqual(repairToolArgs(readSchema, wrapped).filePath, "/etc/passwd");
    const wrapped2 = { args: { path: "/etc/passwd" } };
    assert.deepEqual(repairToolArgs(readSchema, wrapped2).filePath, "/etc/passwd");
  });

  it("auto-repairs other common parameters like content and command", () => {
    const writeSchema = { type: "object", properties: { filePath: {}, content: {} }, required: ["filePath", "content"] };
    const fixed = repairToolArgs(writeSchema, { path: "/a.txt", text: "hello" });
    assert.equal(fixed.filePath, "/a.txt");
    assert.equal(fixed.content, "hello");
  });

  it("preserves already-valid arguments untouched", () => {
    const valid = { filePath: "/ok", offset: 10 };
    assert.deepEqual(repairToolArgs(readSchema, valid), valid);
  });
});
