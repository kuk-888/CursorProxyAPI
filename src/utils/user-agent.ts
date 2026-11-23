/** Metadata-only client identification from the User-Agent header (never any request content). */

const MAX_UA_CHARS = 160;

/** Strip control characters and cap the length so a hostile header cannot bloat memory or the ledger file. */
export function sanitizeUserAgent(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_UA_CHARS);
}

/** Coarse, stable client label used for grouping/filtering in the console. */
export function classifyClient(ua: string): string {
  const s = ua.toLowerCase();
  if (!s) return "unknown";
  const table: Array<[RegExp, string]> = [
    [/kilo/, "Kilo"],
    [/claude-cli|claude-code|claude code|claude-cli/, "Claude Code"],
    [/roo[-\s]?code|roocode/, "Roo Code"],
    [/cline/, "Cline"],
    [/cursor/, "Cursor"],
    [/opencode/, "OpenCode"],
    [/codex/, "Codex"],
    [/openai\/(js|python|node)|openai-python|openai-node/, "OpenAI SDK"],
    [/anthropic/, "Anthropic SDK"],
    [/@ai-sdk|ai-sdk|vercel/, "AI SDK"],
    [/nextchat|chatbox|cherry|lobe/, "Chat App"],
    [/curl\//, "curl"],
    [/python-requests|httpx|aiohttp|python/, "Python"],
    [/node|undici|axios|got\//, "Node"],
    [/mozilla\//, "Browser"]
  ];
  for (const [re, name] of table) if (re.test(s)) return name;
  return "other";
}
