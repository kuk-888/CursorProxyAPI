/**
 * Pre-flight validation of model-produced tool arguments against the client's declared JSON schema.
 *
 * The upstream agent reaches client tools through an MCP wrapper (`CallMcpTool { server, toolName, arguments }`),
 * so the model occasionally emits an empty or mis-nested `arguments` object. Forwarding that to the client makes
 * the client surface a schema error and, after a few repeats, abort the whole session. Catching it here lets the
 * model retry inside the same run, invisibly to the client.
 *
 * Only top-level `required` presence is checked: it is cheap, has no false positives for valid calls, and covers
 * the observed failure. Values are never logged.
 */

export interface ToolArgsProblem {
  /** Required top-level properties that are absent, null, or undefined. */
  missing: string[];
  /** Keys the model sent that the schema does not declare (hint for mis-named fields such as `path` vs `filePath`). */
  unexpected: string[];
  /** Declared top-level property names, used to build a helpful retry message. */
  declared: string[];
}

/** How many invalid calls per tool are bounced back to the model before the gateway stops intervening. */
export const MAX_TOOL_ARG_RETRIES = 1;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function findToolArgsProblem(schema: Record<string, unknown>, args: Record<string, unknown>): ToolArgsProblem | null {
  if (!isRecord(schema) || !isRecord(args)) return null;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((k): k is string => typeof k === "string" && k.length > 0)
    : [];
  if (required.length === 0) return null;
  const missing = required.filter((k) => args[k] === undefined || args[k] === null);
  if (missing.length === 0) return null;
  const declared = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  const declaredSet = new Set(declared);
  const unexpected = declaredSet.size > 0 ? Object.keys(args).filter((k) => !declaredSet.has(k)) : [];
  return { missing, unexpected, declared };
}

/** Message returned to the model as the tool result; mirrors what a strict client would say, but earlier. */
export function formatToolArgsError(toolName: string, problem: ToolArgsProblem): string {
  const parts = [
    `The ${toolName} tool was called with invalid arguments: required ${problem.missing.length > 1 ? "properties" : "property"} ${problem.missing.map((k) => `"${k}"`).join(", ")} ${problem.missing.length > 1 ? "are" : "is"} missing.`
  ];
  if (problem.unexpected.length > 0) {
    parts.push(`Unrecognized ${problem.unexpected.length > 1 ? "keys" : "key"}: ${problem.unexpected.map((k) => `"${k}"`).join(", ")}.`);
  }
  if (problem.declared.length > 0) {
    parts.push(`Accepted properties: ${problem.declared.join(", ")}.`);
  }
  parts.push(`Put every argument inside the "arguments" object of the call and retry ${toolName} with the correct input.`);
  return parts.join(" ");
}

const COMMON_ALIASES: Record<string, string[]> = {
  filepath: ["path", "file_path", "filepath", "target_path", "filename", "file"],
  dirpath: ["path", "dir_path", "directory", "dir", "folder"],
  content: ["text", "data", "contents", "body"],
  command: ["cmd", "shell_command"],
  query: ["pattern", "search_term", "q"],
  pattern: ["query", "search_term"]
};

/**
 * Transparently repairs common model argument mistakes before schema validation:
 * 1. Unnests `args.arguments` or `args.args` if the model wrapped arguments inside an extra MCP envelope.
 * 2. Aliases synonymous property names when a required property is missing (e.g. `path` -> `filePath`).
 * 3. Case-insensitive key matching (e.g. `filepath` -> `filePath`).
 */
export function repairToolArgs(
  schema: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (!isRecord(schema) || !isRecord(args)) return args;
  let repaired: Record<string, unknown> = { ...args };

  // 1. Unnest MCP envelope
  if (repaired.arguments && isRecord(repaired.arguments) && Object.keys(repaired).length === 1) {
    repaired = { ...(repaired.arguments as Record<string, unknown>) };
  } else if (repaired.args && isRecord(repaired.args) && Object.keys(repaired).length === 1) {
    repaired = { ...(repaired.args as Record<string, unknown>) };
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((k): k is string => typeof k === "string" && k.length > 0)
    : [];

  for (const req of required) {
    if (repaired[req] !== undefined && repaired[req] !== null) continue;
    const reqLower = req.toLowerCase();

    // 2. Case-insensitive match (e.g. `filepath` supplied when `filePath` required)
    let matchedKey: string | undefined;
    for (const k of Object.keys(repaired)) {
      if (k.toLowerCase() === reqLower && repaired[k] !== undefined && repaired[k] !== null) {
        matchedKey = k;
        break;
      }
    }
    if (matchedKey) {
      repaired[req] = repaired[matchedKey];
      continue;
    }

    // 3. Known synonyms (e.g. `path` / `file_path` supplied when `filePath` required)
    const aliases = COMMON_ALIASES[reqLower] ?? [];
    for (const alias of aliases) {
      for (const k of Object.keys(repaired)) {
        if (k.toLowerCase() === alias && repaired[k] !== undefined && repaired[k] !== null) {
          matchedKey = k;
          break;
        }
      }
      if (matchedKey) break;
    }
    if (matchedKey) {
      repaired[req] = repaired[matchedKey];
    }
  }

  return repaired;
}
