/**
 * lib/sheet-overlap.ts — detect workbook sheets that repeat the same rows.
 *
 * Found on a real bank-accounting report (Nov 12, 2026): sheet «Без
 * подтверждающих документов» (135 rows) was a subset of sheet «Полный список»
 * (178 rows). Both were sent to the model as-is, and the report then said
 * "313 операций" for 178 real operations (the amounts were right, the counts
 * were not). The row count is also what the audit price is based on.
 *
 * Rule: sheet A repeats sheet B when they share at least three column names
 * and at least 90% of A's rows match rows of B on those shared columns
 * (multiset matching, so two genuinely identical payments are not collapsed).
 * Pure function; tested in scripts/test-statement-facts.ts.
 */
export interface SheetData { name: string; headers: string[]; rows: string[][]; }
export interface SheetOverlap { notes: string[]; duplicateRows: number; /** indices of sheets that repeat another sheet */ repeatedSheets: number[]; }

const MIN_SHARED_COLUMNS = 3;
const MIN_MATCH_SHARE = 0.9;
const norm = (s: string) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export function describeSheetOverlap(sheets: SheetData[]): SheetOverlap {
  const notes: string[] = [];
  let duplicateRows = 0;
  const absorbed = new Set<number>();

  // Smaller sheets first: a sheet can only be a subset of one at least as large.
  const order = sheets.map((_, i) => i).sort((a, b) => sheets[a].rows.length - sheets[b].rows.length);
  for (const ai of order) {
    const a = sheets[ai];
    if (a.rows.length === 0) continue;
    for (let bi = 0; bi < sheets.length; bi++) {
      const b = sheets[bi];
      if (bi === ai || absorbed.has(bi) || b.rows.length < a.rows.length) continue;
      if (b.rows.length === a.rows.length && bi < ai) continue;   // equal sheets: count the pair once

      const bIndex = new Map(b.headers.map((h, i) => [norm(h), i] as const).filter(([h]) => h));
      const shared = a.headers.map((h, i) => ({ ia: i, ib: bIndex.get(norm(h)) }))
        .filter((c): c is { ia: number; ib: number } => norm(a.headers[c.ia]) !== "" && c.ib !== undefined);
      if (shared.length < MIN_SHARED_COLUMNS) continue;

      const pool = new Map<string, number>();
      for (const row of b.rows) {
        const k = shared.map(c => norm(row[c.ib])).join("\u0001");
        pool.set(k, (pool.get(k) ?? 0) + 1);
      }
      let matched = 0;
      for (const row of a.rows) {
        const k = shared.map(c => norm(row[c.ia])).join("\u0001");
        const left = pool.get(k) ?? 0;
        if (left > 0) { matched++; pool.set(k, left - 1); }
      }
      if (matched / a.rows.length < MIN_MATCH_SHARE) continue;

      absorbed.add(ai);
      duplicateRows += matched;
      notes.push(
        `[ВНИМАНИЕ: лист «${a.name}» повторяет строки листа «${b.name}»: ${matched} из ${a.rows.length} его строк ` +
        `совпадают со строками листа «${b.name}» по общим колонкам. Это ОДНИ И ТЕ ЖЕ операции, показанные дважды — ` +
        `не считай и не суммируй их повторно. Количество операций и суммы бери по листу «${b.name}» (${b.rows.length} строк); ` +
        `лист «${a.name}» используй только как признак, по которому эти операции отобраны.]`
      );
      break;
    }
  }
  return { notes, duplicateRows, repeatedSheets: [...absorbed] };
}
