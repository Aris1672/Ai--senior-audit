// Code test (no LLM, no database): per-document quotes and the "each
// operation charged once" rule.   npm run test:billing
import assert from "node:assert/strict";
process.env.LLM_API_KEY ||= "test";

async function main() {
  const { parseCSV, parseFile } = await import("../lib/file-parser");
  const { quoteDocument, describeQuote } = await import("../lib/doc-billing");
  const K = await import("../lib/operation-keys");
  const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
  const RATE = 12.5, PAGE = 20;
  const quote = (fileType: string, parsed: any, known = new Map<string, number>(), same = false) =>
    quoteDocument({ fileType, parsed, knownKeys: known, sameFileAlreadyAccepted: same, operationRateRub: RATE, pageRateRub: PAGE });

  const row = (i: number) => `${String((i % 28) + 1).padStart(2, "0")}.${String((i % 12) + 1).padStart(2, "0")}.2025;${i + 1};ООО Поставщик ${i % 40};${1000 + i},50;Оплата по счёту ${i + 1}`;
  const csvOf = (from: number, to: number) => parseCSV(enc(["Дата;Номер;Контрагент;Сумма;Назначение",
    ...Array.from({ length: to - from }, (_, k) => row(from + k))].join("\n")));

  // 1. The loophole case: 10 operations priced first, then the whole year added in chat.
  const small = csvOf(0, 10), year = csvOf(0, 2000);
  const q1 = quote("csv", small);
  assert.deepEqual([q1.kind, q1.units, q1.newUnits, q1.amountRub], ["operations", 10, 10, 125]);
  const q2 = quote("csv", year, K.mergeKeyLists([small.operationKeys!]));
  assert.deepEqual([q2.kind, q2.units, q2.newUnits, q2.amountRub], ["operations", 2000, 1990, 24875]);
  assert.match(describeQuote("год.csv", q2), /новых — 1990/);

  // 2. Overlapping quarters: Q1 then Jan–Jun → only the second quarter is charged.
  const q3 = quote("csv", csvOf(0, 600), K.mergeKeyLists([csvOf(0, 300).operationKeys!]));
  assert.equal(q3.newUnits, 300);

  // 3. The same file again costs nothing.
  const q4 = quote("csv", year, K.mergeKeyLists([year.operationKeys!]), true);
  assert.deepEqual([q4.kind, q4.amountRub], ["duplicate", 0]);
  // …and even without the identical-bytes check, no operation in it is new.
  assert.equal(quote("csv", year, K.mergeKeyLists([year.operationKeys!])).amountRub, 0);

  // 4. Two payments with the same number, date and amount in ONE file are two operations;
  //    the same pair in a second file is not charged again.
  const twins = parseCSV(enc("Дата;Номер;Сумма\n05.03.2025;77;500,00\n05.03.2025;77;500,00\n06.03.2025;78;10,00"));
  assert.equal(quote("csv", twins).newUnits, 3);
  assert.equal(quote("csv", twins, K.mergeKeyLists([twins.operationKeys!])).newUnits, 0);

  // 5. No payment number → whole-row match, with counting; totals rows without a date are not operations.
  const noNum = parseCSV(enc("Дата;Контрагент;Сумма;Назначение\n01.02.2025;ООО А;100,00;Оплата\n01.02.2025;ООО А;100,00;Оплата\n;Итого;200,00;"));
  assert.equal(noNum.operationKeys!.length, 2);
  assert.ok(noNum.operationKeys!.every(k => k.startsWith("r|")));

  // 6. A numbered key is the same whatever the export format writes.
  assert.equal(K.numberedKey("639041", "13.11.2025", 719), K.numberedKey(" 639041 ", "2025-11-13", "719,00"));
  assert.equal(K.normDate("45700"), "2025-02-12");   // Excel serial day
  assert.equal(K.tableKeys(["Дата", "№ п/п", "Номер документа", "Приход", "Расход"], [["13.11.2025", "1", "639041", "", "719,00"]], 0)[0],
    K.numberedKey("639041", "13.11.2025", 719));

  // 7. The 1C fixture: 71 operations, all numbered; loading it twice charges once.
  const fs = await import("node:fs");
  const b = fs.readFileSync(new URL("./fixtures/ip-ausn-statement.txt", import.meta.url));
  const c1 = await parseFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "1c_txt");
  assert.equal(c1.operationKeys!.length, 71);
  assert.equal(quote("1c_txt", c1).amountRub, 887.5);
  assert.equal(quote("1c_txt", c1, K.mergeKeyLists([c1.operationKeys!])).newUnits, 0);

  // 8. Supporting documents are charged per page.
  const pdf = { rowCount: 40, parseMethod: "pdf", pageCount: 3, textContent: "x".repeat(5000), parsedAt: "" };
  assert.deepEqual([quote("pdf", pdf).kind, quote("pdf", pdf).units, quote("pdf", pdf).amountRub], ["pages", 3, 60]);
  const docx = { rowCount: 12, parseMethod: "docx", textContent: "д".repeat(4000), parsedAt: "" };
  assert.deepEqual([quote("docx", docx).units, quote("docx", docx).amountRub], [3, 60]);       // 4000 / 1800 → 3 pages
  assert.equal(quote("docx", { ...docx, textContent: "д".repeat(1800) }).units, 1);
  assert.equal(quote("pdf", pdf, new Map(), true).amountRub, 0);                              // same file again
  // A table with no date column is a document, not a list of operations.
  const plain = parseCSV(enc("Наименование;Количество\nСтол;2\nСтул;4"));
  assert.equal(plain.operationKeys, undefined);
  assert.equal(quote("csv", plain).kind, "pages");

  // 9. What cannot be read is not charged.
  assert.deepEqual([quote("image", null).kind, quote("image", null).amountRub], ["unreadable", 0]);
  const scan = { rowCount: 0, parseMethod: "pdf", likelyScanned: true, pageCount: 7, textContent: "[…]", parsedAt: "" };
  assert.deepEqual([quote("pdf", scan).kind, quote("pdf", scan).amountRub], ["unreadable", 0]);
  assert.match(describeQuote("скан.pdf", quote("pdf", scan)), /не будет проанализирован/);

  console.log("✅ billing: all checks passed (per-operation and per-page quotes, overlap, duplicates, unreadable)");
}
main().catch(e => { console.error("❌ billing test failed:", e); process.exit(1); });
