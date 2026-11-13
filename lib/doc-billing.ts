/**
 * lib/doc-billing.ts — what one uploaded document costs. Pure functions.
 *
 * Decisions of Nov 12, 2026:
 *   · a list of operations is charged PER OPERATION (analysis rate), whatever
 *     the file type, and each operation once per audit (see operation-keys.ts);
 *   · any other readable document is charged PER PAGE (20 ₽ by default):
 *     one PDF page, or 1 800 characters of Word / Excel / XML text;
 *   · the same file uploaded again costs nothing;
 *   · pages that cannot be read cost nothing — and are not analysed;
 *   · no free pages.
 *
 * Scans and photos (Nov 13, 2026, services/ocr + lib/ocr.ts): recognised at
 * upload; kind "scan" — units = pages of the document, newUnits = pages
 * recognised reliably, and only those are charged (page rate). Pages under the
 * confidence threshold and empty pages cost nothing and are not analysed.
 * Recognition service unavailable at upload → kind "ocr_failed", 0 ₽, not
 * analysed. Without the service configured → "unreadable", as before.
 * The amounts are computed on the server from the stored file. Nothing here
 * takes a number from the browser.
 */
import type { ParseResult } from "./file-parser";
import { countNewKeys } from "./operation-keys";

export const PAGE_CHARS = 1800;
export const DEFAULT_PAGE_RATE_RUB = 20;

export type BillingKind = "operations" | "pages" | "scan" | "unreadable" | "ocr_failed" | "duplicate";

/** Kinds whose units are pages (for the page counter of an audit). */
export const PAGE_KINDS: ReadonlySet<string> = new Set(["pages", "scan"]);
/** Kinds whose file was not read: the same bytes uploaded again are priced afresh, not as a repeat. */
export const NOT_READ_KINDS: ReadonlySet<string> = new Set(["unreadable", "ocr_failed"]);

export interface DocumentQuote {
  kind: BillingKind;
  /** Operations or pages found in the document. */
  units: number;
  /** Units actually charged (operations not already in the audit; pages). */
  newUnits: number;
  rateRub: number;
  amountRub: number;
}

export interface QuoteInput {
  fileType: string;
  parsed: ParseResult | null;
  /** True when an identical file (same bytes) is already accepted in this audit. */
  sameFileAlreadyAccepted: boolean;
  /** Operation keys of every file already accepted in this audit, merged. */
  knownKeys: Map<string, number>;
  operationRateRub: number;
  pageRateRub: number;
  /** The recognition service was configured but failed for this file. */
  ocrUnavailable?: boolean;
}

const money = (n: number) => Math.round(n * 100) / 100;

export function quoteDocument(q: QuoteInput): DocumentQuote {
  const zero = (kind: BillingKind, units = 0, rateRub = 0): DocumentQuote =>
    ({ kind, units, newUnits: 0, rateRub, amountRub: 0 });

  if (q.ocrUnavailable) {
    return zero("ocr_failed", q.parsed?.pageCount ?? (q.fileType === "image" ? 1 : 0));
  }

  if (q.parsed?.parseMethod === "ocr" && q.parsed.ocr) {
    const { pages, reliable } = q.parsed.ocr;
    if (q.sameFileAlreadyAccepted) return zero("duplicate", pages, q.pageRateRub);
    return { kind: "scan", units: pages, newUnits: reliable, rateRub: q.pageRateRub,
             amountRub: money(reliable * q.pageRateRub) };
  }

  if (q.fileType === "image" || !q.parsed || q.parsed.likelyScanned || q.parsed.parseMethod === "fallback") {
    return zero("unreadable", q.parsed?.pageCount ?? (q.fileType === "image" ? 1 : 0));
  }

  const keys = q.parsed.operationKeys;
  if (keys && keys.length > 0) {
    if (q.sameFileAlreadyAccepted) return zero("duplicate", keys.length, q.operationRateRub);
    const newUnits = countNewKeys(keys, q.knownKeys);
    return { kind: "operations", units: keys.length, newUnits, rateRub: q.operationRateRub,
             amountRub: money(newUnits * q.operationRateRub) };
  }

  const chars = q.parsed.textContent?.length ?? 0;
  const pages = q.parsed.parseMethod === "pdf" && q.parsed.pageCount
    ? q.parsed.pageCount
    : Math.ceil(chars / PAGE_CHARS);
  if (pages === 0) return zero("unreadable");
  if (q.sameFileAlreadyAccepted) return zero("duplicate", pages, q.pageRateRub);
  return { kind: "pages", units: pages, newUnits: pages, rateRub: q.pageRateRub,
           amountRub: money(pages * q.pageRateRub) };
}

// ─── Wording for the client ──────────────────────────────────────────────────
function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}
const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, " ") + " ₽";

/** One line per file, shown to the client before they confirm. */
export function describeQuote(fileName: string, q: DocumentQuote): string {
  const ops = (n: number) => `${n} ${plural(n, "операция", "операции", "операций")}`;
  const pgs = (n: number) => `${n} ${plural(n, "страница", "страницы", "страниц")}`;
  switch (q.kind) {
    case "operations":
      return q.newUnits === q.units
        ? `«${fileName}»: ${ops(q.units)} × ${rub(q.rateRub)} = ${rub(q.amountRub)}`
        : `«${fileName}»: ${ops(q.units)}, из них новых — ${q.newUnits} (остальные уже есть в этом аудите и повторно не оплачиваются) × ${rub(q.rateRub)} = ${rub(q.amountRub)}`;
    case "pages":
      return `«${fileName}»: ${pgs(q.units)} × ${rub(q.rateRub)} = ${rub(q.amountRub)}`;
    case "scan": {
      const left = q.units - q.newUnits;
      const one = (n: number) => n % 10 === 1 && n % 100 !== 11;
      if (q.newUnits === 0) {
        const what = q.units === 1 ? "страница не распознана надёжно" : `${pgs(q.units)} — ни одна не распознана надёжно`;
        return `«${fileName}»: скан, ${what} (низкое качество изображения) — документ не будет проанализирован и не оплачивается. Загрузите более чёткую копию или документ в текстовом виде`;
      }
      if (left === 0) {
        return `«${fileName}»: скан, ${one(q.newUnits) ? "распознана" : "распознано"} ${pgs(q.newUnits)} × ${rub(q.rateRub)} = ${rub(q.amountRub)}`;
      }
      const rest = one(left)
        ? `ещё ${pgs(left)} не распознана надёжно или пустая — не анализируется и не оплачивается`
        : `ещё ${pgs(left)} не распознаны надёжно или пустые — не анализируются и не оплачиваются`;
      return `«${fileName}»: скан, ${pgs(q.units)}; распознано надёжно — ${q.newUnits} × ${rub(q.rateRub)} = ${rub(q.amountRub)}; ${rest}`;
    }
    case "ocr_failed":
      return `«${fileName}»: распознавание сканов сейчас недоступно — документ не будет проанализирован и не оплачивается. Загрузите его ещё раз позже`;
    case "duplicate":
      return `«${fileName}»: такой файл уже загружен в этот аудит — повторно не оплачивается`;
    case "unreadable":
      return `«${fileName}»: текст не распознан (изображение или скан) — документ не будет проанализирован и не оплачивается`;
  }
}
