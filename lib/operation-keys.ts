/**
 * lib/operation-keys.ts — one comparable key per operation, for billing.
 *
 * Decision (Nov 12, 2026): an operation is charged once per audit, even when
 * the client uploads files that overlap (the same statement twice, a quarter
 * and then the whole year, two sheets repeating the same rows).
 *
 *   key with a payment number:  n|<number>|<date>|<amount>
 *   key without one:            r|<every cell of the row>
 *
 * Keys are compared as MULTISETS: two rows with the same key in one file are
 * two operations; the same key in a second file is the same operation again.
 * Keys never leave the server and are not stored — they are rebuilt from the
 * files when a new file is quoted.
 */

const clean = (s: unknown) => String(s ?? "").replace(/[\s ]+/g, " ").trim().toLowerCase();

/** "dd.mm.yyyy", ISO, or an Excel serial day → "yyyy-mm-dd"; anything else is returned cleaned. */
export function normDate(v: unknown): string {
  const t = clean(v);
  let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const serial = Math.floor(Number(t));
    if (serial > 20000 && serial < 80000) {
      return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
    }
  }
  return t;
}

/** "1 234,50" / "1234.5" / 1234.5 → "1234.50"; not a number → "". */
export function normAmount(v: unknown): string {
  const t = clean(v).replace(/ /g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  if (!t || !/\d/.test(t)) return "";
  const n = Number(t);
  return Number.isFinite(n) ? Math.abs(n).toFixed(2) : "";
}

const isSequenceCol = (h: string) => /п\s*\/\s*п|п\.\s*п\./.test(h);
const isNumberCol   = (h: string) => !isSequenceCol(h) && /(^|[\s.])(номер|№|n|no)([\s.]|$)/.test(h) && !/счет|счёт|инн|кпп|бик|телефон|договор/.test(h);
const isAmountCol   = (h: string) => /сумма|дебет|кредит|приход|расход|списан|поступ|зачислен/.test(h) && !/валют[аы]$|код/.test(h);

export function numberedKey(number: unknown, date: unknown, amount: unknown): string {
  return `n|${clean(number)}|${normDate(date)}|${normAmount(amount)}`;
}

/**
 * Keys for a table whose date column is known. Rows with an empty date cell
 * (totals, subtitles, blank lines) are not operations and get no key.
 */
export function tableKeys(headers: string[], rows: string[][], dateColIdx: number): string[] {
  if (dateColIdx < 0) return [];
  const h = headers.map(clean);
  const numberCol  = h.findIndex(isNumberCol);
  const amountCols = h.map((x, i) => (isAmountCol(x) ? i : -1)).filter(i => i >= 0);

  const keys: string[] = [];
  for (const row of rows) {
    if (!clean(row[dateColIdx])) continue;
    const number  = numberCol >= 0 ? clean(row[numberCol]) : "";
    const amounts = amountCols.map(i => normAmount(row[i])).filter(a => a && a !== "0.00").sort();
    if (number && amounts.length > 0) {
      keys.push(`n|${number}|${normDate(row[dateColIdx])}|${amounts.join("+")}`);
    } else {
      keys.push("r|" + row.map(clean).join("|"));
    }
  }
  return keys;
}

export function countKeys(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/**
 * Union of several key lists where a key repeated ACROSS lists counts once
 * (per list the count is kept; across lists the largest count wins). Used for
 * the sheets of one workbook and for the files of one audit.
 */
export function mergeKeyLists(lists: string[][]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const list of lists) {
    for (const [k, c] of countKeys(list)) {
      if (c > (merged.get(k) ?? 0)) merged.set(k, c);
    }
  }
  return merged;
}

export function flattenKeys(m: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [k, c] of m) for (let i = 0; i < c; i++) out.push(k);
  return out;
}

/** How many of `keys` are not already covered by `known`. */
export function countNewKeys(keys: string[], known: Map<string, number>): number {
  let fresh = 0;
  for (const [k, c] of countKeys(keys)) fresh += Math.max(0, c - (known.get(k) ?? 0));
  return fresh;
}
