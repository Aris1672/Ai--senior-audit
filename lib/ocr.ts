/**
 * lib/ocr.ts — what is done with the text recognised from a scan or a photo.
 * Pure functions (no HTTP, no storage); the service client is lib/ocr-client.ts.
 *
 * Decisions of Nov 13, 2026:
 *   · recognition runs on our own server (services/ocr), scans never leave it;
 *   · CONFIDENCE GATE: a page read with confidence below OCR_MIN_CONFIDENCE
 *     (default 75) is "not reliably recognised" — its text is not analysed and
 *     the page is not charged; a page with almost no words is "empty" — the
 *     same. Measured: ordinary scans 89–95, scans with a stamp and skew 91–93,
 *     poor phone photos and faxes 22–49;
 *   · reliable pages are charged like any page (20 ₽);
 *   · the agent is told the text came from a scan: an amount from a scan can
 *     support closing a finding only if it matches a figure already in the
 *     base or the statement, and a figure marked [?] proves nothing;
 *   · the text is recognised ONCE at upload and stored beside the file
 *     (`<storage_path>.ocr.json`); every turn reads it from there.
 */
import type { ParseResult } from "./file-parser";

export interface OcrPage {
  page: number;
  text: string;
  /** Tesseract's mean word confidence for the page, 0–100. */
  confidence: number;
  words: number;
  /** Words with digits read with low confidence (marked "[?]" in the text). */
  uncertainNumbers: number;
  /** Degrees the page was turned before the reading that was kept. */
  rotated: number;
}

export type OcrPageStatus = "reliable" | "unreliable" | "empty";

export interface StoredOcr {
  kind: "ocr";
  version: 1;
  engine: string;
  minConfidence: number;
  recognisedAt: string;
  pages: (OcrPage & { status: OcrPageStatus })[];
}

export const DEFAULT_MIN_CONFIDENCE = 75;
/** Fewer words than this on a page → an empty page (a blank back side, a lone signature). */
export const MIN_WORDS = 3;

export function minConfidenceFromEnv(): number {
  const v = Number(process.env.OCR_MIN_CONFIDENCE);
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : DEFAULT_MIN_CONFIDENCE;
}

export function pageStatus(p: OcrPage, minConfidence: number): OcrPageStatus {
  if (p.words < MIN_WORDS || !p.text.trim()) return "empty";
  return p.confidence >= minConfidence ? "reliable" : "unreliable";
}

export function buildStoredOcr(engine: string, pages: OcrPage[], minConfidence: number, now = new Date()): StoredOcr {
  return {
    kind: "ocr", version: 1, engine, minConfidence, recognisedAt: now.toISOString(),
    pages: pages.map(p => ({ ...p, status: pageStatus(p, minConfidence) })),
  };
}

export function parseStoredOcr(buffer: ArrayBuffer | string): StoredOcr {
  const raw = typeof buffer === "string" ? buffer : new TextDecoder("utf-8").decode(buffer);
  const s = JSON.parse(raw);
  if (s?.kind !== "ocr" || !Array.isArray(s.pages)) throw new Error("not a stored recognition result");
  return s as StoredOcr;
}

export const ocrSidecarPath = (storagePath: string) => `${storagePath}.ocr.json`;

export interface OcrCounts { pages: number; reliable: number; unreliable: number; empty: number; }

export function ocrCounts(s: StoredOcr): OcrCounts {
  const c = { pages: s.pages.length, reliable: 0, unreliable: 0, empty: 0 };
  for (const p of s.pages) c[p.status]++;
  return c;
}

// ─── What the model is shown ────────────────────────────────────────────────
export const SCAN_NOTE =
  "[Этот документ — скан или фотография; текст получен распознаванием (OCR) на нашем сервере. " +
  "Возможны ошибки распознавания, прежде всего в цифрах. Число с пометкой [?] распознано неуверенно. " +
  "Правила для такого документа: (1) сумма, дата или номер из скана может служить основанием для предложения " +
  "закрыть вывод (propose_close), только если совпадает с цифрой, уже имеющейся в базе 1С или в выписке; " +
  "не совпадает или помечена [?] — keep_open и попроси документ в текстовом виде или более чёткую копию; " +
  "(2) не делай вывод о нарушении только на основании цифры с пометкой [?]; " +
  "(3) страницы, не распознанные надёжно, не переданы — назови их клиенту и предложи загрузить более чёткую копию; " +
  "(4) при цитировании цифр из скана указывай, что они взяты из скана.]";

const pct = (n: number) => `${Math.round(n)}%`;

export function ocrTextForModel(s: StoredOcr): string {
  const n = s.pages.length;
  const parts = [SCAN_NOTE];
  for (const p of s.pages) {
    const head = `--- Страница ${p.page} из ${n}`;
    if (p.status === "reliable") {
      parts.push(`${head} (распознана, уверенность ${pct(p.confidence)}) ---\n${p.text}`);
    } else if (p.status === "unreliable") {
      parts.push(`${head}: НЕ распознана надёжно (уверенность ${pct(p.confidence)}, порог ${pct(s.minConfidence)}) — содержимое не передано на анализ и не оплачено ---`);
    } else {
      parts.push(`${head}: пустая или почти без текста — не анализируется ---`);
    }
  }
  return parts.join("\n\n");
}

/** The stored result as a ParseResult — for pricing and for the summary kept on the document row. */
export function ocrParseResult(s: StoredOcr): ParseResult {
  const c = ocrCounts(s);
  return {
    rowCount: 0,
    parseMethod: "ocr",
    pageCount: c.pages,
    textContent: ocrTextForModel(s),
    detectedColumns: [`Страниц: ${c.pages}`, `Распознано надёжно: ${c.reliable}`],
    ocr: { ...c, minConfidence: s.minConfidence },
    parsedAt: s.recognisedAt,
  };
}
