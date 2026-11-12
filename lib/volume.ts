// ─── Request volume limit ─────────────────────────────────────────────────────
// Nov 2026 (user decision): no fixed caps on uploaded documents. The parsers
// pass every row and every character through; the only ceiling is what the
// audit model can actually take in ONE request. A request above that ceiling
// is REFUSED with a clear message — nothing is ever cut silently, because an
// audit of a silently shortened document is worse than no audit.
//
// DeepSeek V4 Pro: 1,000,000-token context window (provider listings, Nov
// 2026 — the official page could not be opened from the build workspace;
// override with LLM_CONTEXT_TOKENS if it differs). The window is shared by
// input and output, so the output budget and a reserve are subtracted.
//
// Characters per token: ~2.7 measured on Russian prose for this model; tables
// full of digits and separators tokenise worse, so the estimate uses 1.8 to
// stay on the safe side. If the estimate is still too generous the API
// rejects the request, and isContextLimitError() turns that into the same
// clear message.
import { LLM_PROVIDER, AUDIT_MAX_OUTPUT_TOKENS } from "./llm";

const DEFAULT_CONTEXT_TOKENS = LLM_PROVIDER === "deepseek" ? 1_000_000 : 200_000;
const RESERVE_TOKENS  = 20_000;   // review-pass draft, continuation text, framing
const CHARS_PER_TOKEN = 1.8;

function positiveInt(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export const LLM_CONTEXT_TOKENS = positiveInt(process.env.LLM_CONTEXT_TOKENS) ?? DEFAULT_CONTEXT_TOKENS;

/** Largest request (system prompt + documents + chat history), in characters. */
export const MAX_REQUEST_CHARS =
  positiveInt(process.env.LLM_MAX_REQUEST_CHARS) ??
  Math.floor((LLM_CONTEXT_TOKENS - AUDIT_MAX_OUTPUT_TOKENS - RESERVE_TOKENS) * CHARS_PER_TOKEN);

export interface VolumePart { name: string; chars: number }

export interface VolumeCheck {
  ok: boolean;
  totalChars: number;
  limitChars: number;
  /** Russian message for the client when !ok. Contains file names and sizes only. */
  message?: string;
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU").replace(/ | /g, " ");
}

/**
 * Checks one audit request against the model's limit.
 * @param otherChars system prompt + audit context + chat history (everything except documents)
 * @param documents  per-document text sizes
 */
export function checkRequestVolume(otherChars: number, documents: VolumePart[]): VolumeCheck {
  const docChars   = documents.reduce((s, d) => s + d.chars, 0);
  const totalChars = otherChars + docChars;
  if (totalChars <= MAX_REQUEST_CHARS) return { ok: true, totalChars, limitChars: MAX_REQUEST_CHARS };

  const list = [...documents]
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 10)
    .map(d => `«${d.name}» — ${fmt(d.chars)} знаков`)
    .join("; ");

  return {
    ok: false, totalChars, limitChars: MAX_REQUEST_CHARS,
    message:
      `Объём документов превышает то, что можно проанализировать за один запрос: ` +
      `${fmt(totalChars)} знаков при пределе ${fmt(MAX_REQUEST_CHARS)}. ` +
      `Запрос не отправлен на анализ — документы не сокращались и не обрезались. ` +
      (list ? `Документы: ${list}. ` : "") +
      `Разделите проверку на части (например, по кварталам или по отдельным счетам) ` +
      `и проведите отдельный аудит по каждой части.`,
  };
}

/** Same refusal when the estimate passed but the model's API rejected the size. */
export const CONTEXT_LIMIT_MESSAGE =
  "Модель не смогла принять документы такого объёма за один запрос. " +
  "Анализ не выполнен — документы не сокращались и не обрезались. " +
  "Разделите проверку на части (например, по кварталам или по отдельным счетам) " +
  "и проведите отдельный аудит по каждой части.";

/** True for the provider's "prompt too long / context length exceeded" errors. */
export function isContextLimitError(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null;
  const msg = String(e?.message ?? "").toLowerCase();
  const sizeWords = /context length|context window|maximum context|too many tokens|prompt is too long|input is too long|exceeds? the (model'?s )?(maximum|max|context)|request too large|payload too large/;
  if (e?.status === 413) return true;
  return (e?.status === 400 || e?.status === undefined) && sizeWords.test(msg);
}
