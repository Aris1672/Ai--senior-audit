/**
 * lib/doc-billing.ts — what one uploaded document costs. Pure functions.
 *
 * Decisions of Nov 12, 2026:
 *   · a list of operations is charged PER OPERATION (analysis rate), whatever
 *     the file type, and each operation once per audit (see operation-keys.ts);
 *   · any other readable document is charged PER PAGE (20 ₽ by default):
 *     one PDF page, or 1 800 characters of Word / Excel / XML text;
 *   · the same file uploaded again costs nothing;
 *   · pages that cannot be read (images and scans, until text recognition is
 *     connected) cost nothing — and are not analysed;
 *   · no free pages.
 * The amounts are computed on the server from the stored file. Nothing here
 * takes a number from the browser.
 */
import type { ParseResult } from "./file-parser";
import { countNewKeys } from "./operation-keys";

export const PAGE_CHARS = 1800;
export const DEFAULT_PAGE_RATE_RUB = 20;

export type BillingKind = "operations" | "pages" | "unreadable" | "duplicate";

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
}

const money = (n: number) => Math.round(n * 100) / 100;

export function quoteDocument(q: QuoteInput): DocumentQuote {
  const zero = (kind: BillingKind, units = 0, rateRub = 0): DocumentQuote =>
    ({ kind, units, newUnits: 0, rateRub, amountRub: 0 });

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
    case "duplicate":
      return `«${fileName}»: такой файл уже загружен в этот аудит — повторно не оплачивается`;
    case "unreadable":
      return `«${fileName}»: текст не распознан (изображение или скан) — документ не будет проанализирован и не оплачивается`;
  }
}
