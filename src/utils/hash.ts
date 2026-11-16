import crypto from "node:crypto";
import type { NormalizedImage } from "../core/types.js";

const SECRET_REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bcrsr_[A-Za-z0-9_-]{6,}\b/g, "crsr_[REDACTED]"],
  [/\bsk-cgw-[A-Za-z0-9_-]{6,}\b/g, "sk-cgw-[REDACTED]"],
  [/\badm_[A-Za-z0-9._-]{10,}\b/g, "adm_[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?\b/g, "[REDACTED_JWT]"],
  [/WorkosCursorSessionToken=[^\s"';,]+/gi, "WorkosCursorSessionToken=[REDACTED]"]
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const [pattern, replacement] of SECRET_REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function safeStringEquals(a: string, b: string): boolean {
  const digestA = crypto.createHash("sha256").update(a, "utf8").digest();
  const digestB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function normalizeBaseModelId(modelId: string): string {
  let base = modelId.split("[")[0]?.trim().toLowerCase() ?? "";
  if (base === "default") return "auto";
  if (base.endsWith("-fast")) base = base.slice(0, -"-fast".length);
  if (base.endsWith("-slow")) base = base.slice(0, -"-slow".length);
  const ctxSuffix = /^(.+?)-(\d+(?:\.\d+)?[km])$/i.exec(base);
  if (ctxSuffix) base = ctxSuffix[1]!;
  return base;
}

export function computeConversationHash(parts: readonly string[]): string {
  const h = crypto.createHash("sha256");
  for (const p of parts) {
    h.update(p);
    h.update("\0");
  }
  return h.digest("hex").slice(0, 32);
}

/** Stable digest of attached images so two dialogs differing only by an image never share a warm agent. */
function imagesDigest(images: readonly NormalizedImage[]): string {
  if (!images.length) return "";
  const h = crypto.createHash("sha256");
  for (const img of images) h.update("url" in img ? `u:${img.url}` : `d:${img.mimeType}:${img.data}`).update("\0");
  return h.digest("hex").slice(0, 16);
}

export function extendHashWithAssistantReply(inputPrefixHash: string, assistantText: string): string {
  return crypto
    .createHash("sha256")
    .update(inputPrefixHash)
    .update("\0ASSISTANT_TEXT:")
    .update(assistantText.trim())
    .digest("hex")
    .slice(0, 32);
}

export interface HashableDialogItem {
  role: "user" | "assistant" | "tool";
  text: string;
  images: NormalizedImage[];
  hasTools: boolean;
}

export interface ComputedDialogPrefix {
  priorPrefixHash?: string;
  currentInputPrefixHash?: string;
  incrementalUserText?: string;
  incrementalImages?: NormalizedImage[];
}

/**
 * Unified incremental prefix hash calculator shared across OpenAI & Anthropic protocols.
 * Enables O(1) Warm Agent lookup for multi-turn pure conversations.
 */
export function computeDialogPrefixHashes(params: {
  systemPrompt: string;
  toolNamesSignature: string;
  items: readonly HashableDialogItem[];
}): ComputedDialogPrefix {
  const { systemPrompt, toolNamesSignature, items } = params;
  if (items.length === 0 || items.some((it) => it.hasTools || it.role === "tool")) {
    return {};
  }
  const last = items[items.length - 1];
  if (last.role !== "user") {
    return {};
  }

  let runningHash = computeConversationHash([`SYS:${systemPrompt}`, `TOOLS:${toolNamesSignature}`]);
  let priorPrefixHash: string | undefined;
  let incrementalUserText: string | undefined;
  let incrementalImages: NormalizedImage[] | undefined;

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (i === items.length - 1 && i > 0) {
      priorPrefixHash = runningHash;
      incrementalUserText = it.text;
      incrementalImages = it.images;
    }
    if (it.role === "user") {
      runningHash = computeConversationHash([runningHash, `USER:${it.text.trim()}`, `IMG:${imagesDigest(it.images)}`]);
    } else if (it.role === "assistant") {
      runningHash = extendHashWithAssistantReply(runningHash, it.text);
    }
  }

  return {
    ...(priorPrefixHash ? { priorPrefixHash } : {}),
    currentInputPrefixHash: runningHash,
    ...(incrementalUserText !== undefined ? { incrementalUserText } : {}),
    ...(incrementalImages ? { incrementalImages } : {})
  };
}
