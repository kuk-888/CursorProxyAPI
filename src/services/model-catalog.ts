import { Cursor, type ModelSelection, type SDKModel } from "@cursor/sdk";

export const DEFAULT_MODEL = "auto";

interface CachedCatalog {
  models: SDKModel[];
  expiresAt: number;
}

const CATALOG_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map<string, CachedCatalog>();

function sanitizeModelsCatalog(models: SDKModel[]): void {
  for (const m of models) {
    if (m.id === "grok-4.7" && Array.isArray(m.parameters)) {
      for (const p of m.parameters) {
        if (p.id === "context" && Array.isArray(p.values)) {
          // Cursor upstream advertises 500k for grok-4.7, but its inference backend rejects it with:
          // 'AI Model Not Found Invalid parameters for registry model: "grok-4.7"'.
          // Sanitize catalog so 500k is omitted and only 256k is advertised/permitted.
          p.values = p.values.filter((v) => {
            const val = typeof v === "object" && v !== null && "value" in v ? String(v.value) : String(v);
            return val !== "500k";
          });
        }
      }
    }
  }
}

export async function listLiveModels(
  apiKey: string,
  fetcher: (key: string) => Promise<SDKModel[]> = (key) => Cursor.models.list({ apiKey: key })
): Promise<SDKModel[]> {
  const now = Date.now();
  const hit = catalogCache.get(apiKey);
  if (hit && hit.expiresAt > now) return hit.models;
  const models = await fetcher(apiKey);
  sanitizeModelsCatalog(models);
  catalogCache.set(apiKey, { models, expiresAt: now + CATALOG_TTL_MS });
  return models;
}

export function isGrok46Family(modelId: string): boolean {
  const id = modelId.trim().toLowerCase().replace(/-fast$/, "");
  return id === "grok-4.6" || id.startsWith("grok-4.6") || id === "cursor-grok" || id.startsWith("cursor-grok");
}

type CanonicalEffortIntent = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

function parseEffortIntent(raw: unknown): CanonicalEffortIntent | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const k = raw.trim().toLowerCase().replace(/_/g, "-");
  if (k === "off" || k === "none" || k === "false" || k === "0" || k === "disabled") return "off";
  if (k === "minimal" || k === "min") return "minimal";
  if (k === "low") return "low";
  if (k === "medium" || k === "mid") return "medium";
  if (k === "high") return "high";
  if (k === "xhigh" || k === "x-high" || k === "extra-high" || k === "extrahigh") return "xhigh";
  if (k === "max") return "max";
  return undefined;
}

function extractBodyEffortIntent(body: Record<string, unknown>): CanonicalEffortIntent | undefined {
  const reasoningObj = body.reasoning && typeof body.reasoning === "object" && !Array.isArray(body.reasoning)
    ? (body.reasoning as Record<string, unknown>)
    : {};
  const outputConfig = body.output_config && typeof body.output_config === "object" && !Array.isArray(body.output_config)
    ? (body.output_config as Record<string, unknown>)
    : {};

  const directCandidates = [
    body.reasoning_effort,
    body.effort,
    typeof body.reasoning === "string" ? body.reasoning : undefined,
    reasoningObj.effort,
    outputConfig.effort
  ];
  for (const c of directCandidates) {
    const parsed = parseEffortIntent(c);
    if (parsed) return parsed;
  }

  // Anthropic `thinking: { type: "enabled" | "adaptive" | "disabled", budget_tokens }`
  if (body.thinking === false) return "off";
  if (body.thinking === true) return "high";
  if (body.thinking && typeof body.thinking === "object" && !Array.isArray(body.thinking)) {
    const t = body.thinking as Record<string, unknown>;
    if (t.type === "disabled") return "off";
    if (t.type === "enabled" || t.type === "adaptive") {
      const budget = typeof t.budget_tokens === "number" ? t.budget_tokens : 8192;
      if (budget >= 24000) return "xhigh";
      if (budget >= 12000) return "high";
      if (budget >= 4000) return "medium";
      return "low";
    }
  }
  return undefined;
}

/**
 * Match a canonical effort intent to the closest allowed value in a specific model parameter's `values` list.
 * Handles subtle differences across Cursor's 48+ models:
 *  - `gpt-5.4` / `gpt-5.5` use `"extra-high"`, whereas `grok-4.6` / `claude-opus-5-5` use `"xhigh"`
 *  - `kimi-k3` / `glm-5p3` only have `["low", "high", "max"]` (no `"medium"`)
 *  - `glm-5.2` only has `["high", "max"]`
 */
function snapEffortToAllowedValues(
  intent: CanonicalEffortIntent,
  allowedValues: readonly string[]
): string | null {
  if (allowedValues.length === 0) {
    return intent === "off" ? null : intent;
  }

  const preferenceOrder: Record<CanonicalEffortIntent, string[]> = {
    off: ["none", "off"],
    minimal: ["minimal", "low", "none", "medium", "high"],
    low: ["low", "minimal", "medium", "high"],
    medium: ["medium", "high", "low", "max"],
    high: ["high", "medium", "xhigh", "extra-high", "max", "low"],
    xhigh: ["xhigh", "extra-high", "max", "high", "medium"],
    max: ["max", "xhigh", "extra-high", "high"]
  };

  for (const candidate of preferenceOrder[intent]) {
    if (allowedValues.includes(candidate)) return candidate;
  }
  return intent === "off" ? null : allowedValues[allowedValues.length - 1]!;
}

function snapContextToAllowedValues(requestedCtx: string, allowedValues: readonly string[]): string | null {
  const norm = requestedCtx.trim().toLowerCase();
  if (allowedValues.length === 0) return norm;
  if (allowedValues.includes(norm)) return norm;

  // Parse token magnitude (e.g. "1m" -> 1000, "500k" -> 500) and pick best match
  const toK = (s: string): number => {
    const m = /^(\d+(?:\.\d+)?)([km])$/i.exec(s.trim());
    if (!m) return 0;
    return Number(m[1]) * (m[2]!.toLowerCase() === "m" ? 1000 : 1);
  };
  const targetK = toK(norm);
  if (targetK <= 0) return allowedValues[allowedValues.length - 1]!;

  // Pick largest allowed context <= targetK, or largest available if user asked for 1m on a 500k model
  const sorted = [...allowedValues].sort((a, b) => toK(a) - toK(b));
  const le = sorted.filter((v) => toK(v) <= targetK);
  return le.length > 0 ? le[le.length - 1]! : sorted[0]!;
}

function getParamAllowedValues(modelSchema: SDKModel | undefined, paramId: string): string[] | undefined {
  const p = modelSchema?.parameters?.find((x) => x.id === paramId);
  if (!p) return undefined;
  return (p.values ?? []).map((v) => (typeof v === "object" && v !== null && "value" in v ? String(v.value) : String(v)));
}

/**
 * Schema-driven universal model & parameter resolver across all 48+ Cursor models.
 * Automatically translates between `effort`, `reasoning_effort`, `reasoning`, and `thinking`,
 * snaps value aliases (`xhigh` <-> `extra-high` <-> `max`), clamps `context`, and strips
 * unsupported parameters so zero models fail with `invalid_argument`!
 */
export function resolveModelSelection(
  requestedModel: string | undefined,
  body: Record<string, unknown> = {},
  modelSchema?: SDKModel
): { selection: ModelSelection; canonicalId: string } {
  const raw = (requestedModel || "").trim() || DEFAULT_MODEL;
  const match = /^([^\[]+?)(?:\[(.*)\])?$/.exec(raw);
  let id = (match?.[1] || DEFAULT_MODEL).trim();
  if (id.toLowerCase() === "default") id = DEFAULT_MODEL;

  let fastSuffix = false;
  if (id === "composer-2.5-fast") {
    id = "composer-2.5";
    fastSuffix = true;
  } else if (id === "composer-2.5-slow") {
    id = "composer-2.5";
  } else if (id.toLowerCase().endsWith("-fast")) {
    id = id.slice(0, -"-fast".length);
    fastSuffix = true;
  }

  // Handle context magnitude suffixes e.g. "grok-4.7-500k" or "grok-4.7-256k"
  let suffixContext: string | undefined;
  const ctxSuffixMatch = /^(.+?)-(\d+(?:\.\d+)?[km])$/i.exec(id);
  if (ctxSuffixMatch) {
    id = ctxSuffixMatch[1]!;
    suffixContext = ctxSuffixMatch[2]!.toLowerCase();
  }

  // Parse raw bracket entries `[effort=high,fast=true,1m]`
  const rawBracketMap = new Map<string, string>();
  let bracketEffortIntent: CanonicalEffortIntent | undefined;
  let bracketThinkingBool: string | undefined;
  let bracketContext: string | undefined;
  let bracketFast: string | undefined;

  const rawBracket = match?.[2]?.trim();
  if (rawBracket) {
    for (const entry of rawBracket.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) {
        if (/^\d+(?:\.\d+)?[km]$/i.test(trimmed)) {
          bracketContext = trimmed.toLowerCase();
        }
        continue;
      }
      const pKey = trimmed.slice(0, eq).trim();
      const pVal = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (!pKey || !pVal) continue;

      if (pKey === "effort" || pKey === "reasoning_effort" || pKey === "reasoning") {
        bracketEffortIntent = parseEffortIntent(pVal) ?? bracketEffortIntent;
        rawBracketMap.set(pKey, pVal);
      } else if (pKey === "thinking") {
        bracketThinkingBool = pVal.toLowerCase() === "false" ? "false" : "true";
      } else if (pKey === "context") {
        bracketContext = pVal.toLowerCase();
      } else if (pKey === "fast") {
        bracketFast = pVal.toLowerCase() === "true" ? "true" : "false";
      } else if (id === "auto-smart" && pKey === "mode") {
        rawBracketMap.set("optimize_for", pVal);
      } else {
        rawBracketMap.set(pKey, pVal);
      }
    }
  }

  const schemaParamIds = modelSchema
    ? new Set((modelSchema.parameters ?? []).map((p) => p.id))
    : undefined;

  const grok46 = isGrok46Family(id);
  const bodyEffortIntent = extractBodyEffortIntent(body);
  const effectiveEffortIntent = bodyEffortIntent ?? bracketEffortIntent ?? (grok46 ? "high" : undefined);

  const serviceTier = typeof body.service_tier === "string" ? body.service_tier.trim().toLowerCase() : "";
  const bodyFast = typeof body.fast === "boolean"
    ? String(body.fast)
    : body.cursor_fast === true || serviceTier === "priority" || serviceTier === "fast"
      ? "true"
      : serviceTier === "default"
        ? "false"
        : undefined;
  const effectiveFast = bracketFast ?? (fastSuffix ? "true" : bodyFast) ?? (grok46 ? "false" : undefined);

  let effectiveContext = bracketContext
    ?? suffixContext
    ?? (typeof body.cursor_context === "string" && body.cursor_context.trim()
      ? body.cursor_context.trim().toLowerCase()
      : typeof body.context === "string" && body.context.trim()
        ? body.context.trim().toLowerCase()
        : undefined);

  // grok-4.7 upstream constraint: Cursor backend rejects 500k with 'Invalid parameters'.
  // Auto-snap any 500k request for grok-4.7 to 256k.
  if (id === "grok-4.7" && effectiveContext === "500k") {
    effectiveContext = "256k";
  }

  const finalParams = new Map<string, string>();

  // 1. Fast parameter
  if (effectiveFast !== undefined) {
    if (!schemaParamIds || schemaParamIds.has("fast")) {
      finalParams.set("fast", effectiveFast);
    }
  }

  // 2. Thinking boolean parameter (used by Claude 4.5 / 4.6 / 5 models)
  if (schemaParamIds?.has("thinking")) {
    if (bracketThinkingBool !== undefined) {
      finalParams.set("thinking", bracketThinkingBool);
    } else if (effectiveEffortIntent !== undefined) {
      finalParams.set("thinking", effectiveEffortIntent === "off" ? "false" : "true");
    }
  } else if (!schemaParamIds && bracketThinkingBool !== undefined) {
    finalParams.set("thinking", bracketThinkingBool);
  }

  // 3. Effort / Reasoning_Effort / Reasoning level parameter
  const targetEffortKey = schemaParamIds
    ? (["effort", "reasoning_effort", "reasoning"].find((k) => schemaParamIds.has(k)) ?? null)
    : id === "grok-4.7" || id.startsWith("gemini-") || id.startsWith("deepseek-") || id === "claude-sonnet-5-5"
      ? "reasoning_effort"
      : id.startsWith("gpt-5") || id.startsWith("kimi-") || id.startsWith("glm-")
        ? "reasoning"
        : "effort";

  if (targetEffortKey && effectiveEffortIntent !== undefined) {
    const allowed = getParamAllowedValues(modelSchema, targetEffortKey) ?? [];
    const snapped = snapEffortToAllowedValues(effectiveEffortIntent, allowed);
    if (snapped !== null) {
      finalParams.set(targetEffortKey, snapped);
    }
  }

  // 4. Context window parameter (`context`)
  if (effectiveContext) {
    if (!schemaParamIds || schemaParamIds.has("context")) {
      const allowed = getParamAllowedValues(modelSchema, "context") ?? [];
      const snappedCtx = snapContextToAllowedValues(effectiveContext, allowed);
      if (snappedCtx) {
        const finalCtx = id === "grok-4.7" && snappedCtx === "500k" ? "256k" : snappedCtx;
        finalParams.set("context", finalCtx);
      }
    }
  }

  // 5. Carry over any other valid custom schema params (e.g. `optimize_for`)
  for (const [k, v] of rawBracketMap.entries()) {
    if (k === "effort" || k === "reasoning_effort" || k === "reasoning") continue;
    if (!schemaParamIds || schemaParamIds.has(k)) {
      finalParams.set(k, v);
    }
  }

  const params = Array.from(finalParams, ([pId, value]) => ({ id: pId, value }));
  const selection: ModelSelection = params.length > 0 ? { id, params } : { id };
  const canonicalId = params.length > 0
    ? `${id}[${params.map((p) => `${p.id}=${p.value}`).join(",")}]`
    : id;

  return { selection, canonicalId };
}

export function formatOpenAiModelList(models: SDKModel[]): Array<{
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  name?: string;
}> {
  const seen = new Set<string>();
  const out: Array<{ id: string; object: "model"; created: number; owned_by: string; name?: string }> = [];

  for (const m of models) {
    if (!m.id) continue;
    // Cursor's catalog names Auto `id: "default", displayName: "Auto"` — expose `"auto"` cleanly too!
    const primaryId = m.id === "default" ? "auto" : m.id;
    if (!seen.has(primaryId)) {
      seen.add(primaryId);
      out.push({
        id: primaryId,
        object: "model",
        created: 0,
        owned_by: "cursor",
        ...(m.displayName ? { name: m.displayName } : {})
      });
    }
  }
  return out;
}
