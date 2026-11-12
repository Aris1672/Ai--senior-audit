/**
 * scripts/test-statement-facts.ts — code test for lib/statement-facts.ts.
 * No network, no LLM: runs in a second.   npm run test:facts
 * Checks the facts computed for the anonymised fixture against values
 * verified by an independent calculation (Nov 12, 2026), plus edge cases.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseFile } from "../lib/file-parser";
import { computeStatementFacts, buildStatementFacts, type FactsTx } from "../lib/statement-facts";

async function main() {
  // ── 1. Fixture through the real parser ─────────────────────────────────────
  const buf = fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "ip-ausn-statement.txt"));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const parsed = await parseFile(ab, "1c_txt");
  const text = parsed.textContent ?? "";
  for (const s of [
    "=== РАСЧЁТНЫЕ ФАКТЫ", "=== СПИСОК ОПЕРАЦИЙ ===",
    "Поступления: 54 171,37 (22 оп.); списания: 54 133,04 (49 оп.)",
    "СОВПАДАЮТ с суммой операций", "конечный по выписке 38,33 — СХОДИТСЯ",
    "Счёт 40802810000000000002: переведено на него 3 983,64, возвращено с него 2 376,00, сальдо (осталось на нём из переводов периода) 1 607,64",
    "20.11.2025 → на счёт      1 137,00",
    "51 795,37 (95,6% всех поступлений)",
    "31 700,00 — 8 оп., 61,2% этой группы, 58,5% всех поступлений",
    "43 681,43 — 29 оп., 87,1% этой группы, 80,7% всех списаний",
    "документ № 83973/007, 2 462,39 × 2: 08.12.2025 (п/п 34); 26.12.2025 (п/п 35)",
  ]) assert.ok(text.includes(s), `fixture facts must contain: ${s}`);
  assert.ok(text.indexOf("РАСЧЁТНЫЕ ФАКТЫ") < text.indexOf("direction;date;amount"), "facts come before the operation list");
  assert.equal((text.match(/× \d+:/g) ?? []).length, 1, "exactly one repeated-payment candidate in the fixture");

  // ── 2. Edge cases on synthetic operations ──────────────────────────────────
  const me = { inn: "111", acc: "A1" };
  const out = (date: string, amount: number, name: string, inn: string, acc: string, purpose: string, number = "1"): FactsTx =>
    ({ number, date, amount, direction: "debit", payerInn: me.inn, payerAccount: me.acc, receiverName: name, receiverInn: inn, receiverAccount: acc, purpose });
  const inc = (date: string, amount: number, name: string, inn: string, acc: string, purpose: string, number = "1"): FactsTx =>
    ({ number, date, amount, direction: "credit", receiverInn: me.inn, receiverAccount: me.acc, payerName: name, payerInn: inn, payerAccount: acc, purpose });

  const f = computeStatementFacts([
    inc("05.01.2025", 100.10, "Покупатель", "222", "B1", "Оплата по счёту № 7"),
    inc("06.01.2025", 0.20,   "Покупатель", "222", "B1", "Оплата по счёту № 8"),
    out("07.01.2025", 50,     "Я сам", "111", "A2", "на накопительный"),
    inc("08.01.2025", 20,     "Я сам", "111", "A2", "возврат"),
    out("09.01.2025", 30,     "Аренда", "333", "C1", "Аренда по договору № 5 за январь", "10"),
    out("09.02.2025", 30,     "Аренда", "333", "C1", "Аренда по договору № 5 за февраль", "11"),
    out("10.02.2025", 10,     "Поставщик", "444", "D1", "Счёт № 12", "12"),
    out("11.02.2025", 15,     "Поставщик", "444", "D1", "Счёт № 12 доплата", "13"),   // same doc, different amount
    out("12.02.2025", 10,     "Другой", "555", "E1", "Счёт № 12", "14"),               // same doc+amount, other receiver
  ], { account: "A1", openingBalance: 0, totalCredits: 120.30, totalDebits: 145, closingBalance: -24.70 });

  assert.equal(f.ownInn, "111");
  assert.equal(f.creditsKop, 12030, "kopeck-exact sum (no float drift: 100.10 + 0.20 + 20)");
  assert.equal(f.totalsMatch, true);
  assert.equal(f.balanceMatch, true);
  assert.equal(f.ownAccounts.length, 1);
  assert.deepEqual([f.ownAccounts[0].account, f.ownAccounts[0].toKop, f.ownAccounts[0].fromKop], ["A2", 5000, 2000]);
  assert.equal(f.thirdPartyInKop, 10030, "own-account return is not third-party inflow");
  assert.equal(f.thirdPartyOutKop, 9500, "own-account transfer is not third-party outflow");
  assert.equal(f.firstDate, "05.01.2025"); assert.equal(f.lastDate, "12.02.2025");
  // Rent by the same contract number and amount IS listed as a candidate (the
  // block tells the model regular contract payments are not duplicates);
  // different amount or different receiver is NOT.
  assert.equal(f.repeats.length, 1);
  assert.deepEqual([f.repeats[0].receiver, f.repeats[0].docRef, f.repeats[0].ops.length], ["Аренда", "5", 2]);

  const mismatch = computeStatementFacts([inc("01.01.2025", 10, "X", "9", "Z", "")],
    { account: "A1", openingBalance: 0, totalCredits: 99, totalDebits: 0, closingBalance: 99 });
  assert.equal(mismatch.totalsMatch, false, "missing operations are detected");
  assert.equal(buildStatementFacts([]), "", "no operations → no block");

  console.log("✅ statement-facts: all checks passed");
}
main().catch(e => { console.error("❌", e.message ?? e); process.exit(1); });
