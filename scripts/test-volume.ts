// Code test (no LLM): documents are never cut, oversized requests are refused.
//   npm run test:volume
import assert from "node:assert/strict";
process.env.LLM_API_KEY ||= "test";
delete process.env.LLM_CONTEXT_TOKENS;
delete process.env.LLM_MAX_REQUEST_CHARS;

async function main() {
  const { parseCSV, parse1CTxt, toParsedSummary } = await import("../lib/file-parser");
  const { checkRequestVolume, MAX_REQUEST_CHARS, isContextLimitError } = await import("../lib/volume");
  const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
  // 1C exports are Windows-1251.
  const cp1251 = (s: string) => Uint8Array.from([...s].map(ch => {
    const c = ch.charCodeAt(0);
    if (c < 128) return c;
    if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
    if (ch === "ё") return 0xb8; if (ch === "Ё") return 0xa8;
    return 0x3f;
  })).buffer as ArrayBuffer;

  // 1. CSV with 5 000 rows: every row reaches the model text, the last one included.
  const rows = Array.from({ length: 5000 }, (_, i) =>
    `${String((i % 28) + 1).padStart(2, "0")}.03.2025;ООО Поставщик ${i};${1000 + i},50;Оплата по счёту ${i}`);
  const csv = parseCSV(enc(["Дата;Контрагент;Сумма;Назначение", ...rows].join("\n")));
  assert.equal(csv.rowCount, 5000);
  assert.ok(csv.textContent!.includes("Оплата по счёту 4999"), "last CSV row must be present");
  assert.ok(!/Показаны первые|обрезан/i.test(csv.textContent!), "no truncation note");

  // 2. 1C statement with 1 200 operations: all present.
  const ops = Array.from({ length: 1200 }, (_, i) => [
    "СекцияДокумент=Платежное поручение", `Номер=${i + 1}`, "Дата=15.03.2025", `Сумма=${100 + i}.00`,
    "ПлательщикСчет=40702810000000000001", "ПлательщикИНН=7700000001", "Плательщик1=ООО Тест",
    "ПолучательСчет=40702810000000000002", "ПолучательИНН=7700000002", `Получатель1=ООО Контрагент ${i}`,
    `НазначениеПлатежа=Оплата по договору ${i + 1}`, "КонецДокумента",
  ].join("\r\n"));
  const txt = ["1CClientBankExchange", "ВерсияФормата=1.03", "Кодировка=Windows",
    "РасчСчет=40702810000000000001", ...ops, "КонецФайла"].join("\r\n");
  const c1 = parse1CTxt(cp1251(txt));
  assert.equal(c1.rowCount, 1200);
  assert.ok(c1.textContent!.includes("Оплата по договору 1200"), "last 1C operation must be present");

  // 3. The database cache holds no document text.
  const summary = toParsedSummary(csv) as Record<string, unknown>;
  assert.equal(summary.textContent, undefined);
  assert.equal(summary.textChars, csv.textContent!.length);
  assert.equal(summary.rowCount, 5000);

  // 4. Volume check: under the limit passes; over it is refused with names and sizes.
  assert.ok(MAX_REQUEST_CHARS > 1_000_000, `limit should reflect a 1M-token model, got ${MAX_REQUEST_CHARS}`);
  assert.equal(checkRequestVolume(30_000, [{ name: "a.csv", chars: csv.textContent!.length }]).ok, true);
  const over = checkRequestVolume(30_000, [
    { name: "год.xlsx", chars: MAX_REQUEST_CHARS }, { name: "малый.csv", chars: 1000 }]);
  assert.equal(over.ok, false);
  assert.ok(over.message!.includes("«год.xlsx»") && over.message!.includes("не обрезались"));

  // 5. Provider "too long" errors are recognised; ordinary errors are not.
  assert.ok(isContextLimitError({ status: 400, message: "This model's maximum context length is 1000000 tokens" }));
  assert.ok(isContextLimitError({ status: 413, message: "x" }));
  assert.ok(!isContextLimitError({ status: 400, message: "invalid tool schema" }));
  assert.ok(!isContextLimitError(new Error("fetch failed")));

  // 6. Name-service pieces: nothing lost, no piece over the size, cut at line ends.
  const { splitForNer } = await import("../lib/ner-client");
  const big = csv.textContent!.repeat(3);
  const pieces = splitForNer([big, "короткий текст"]);
  assert.equal(pieces.join(""), big + "короткий текст");
  assert.ok(pieces.length > 3 && pieces.every(p => p.length <= 150_000));
  assert.ok(pieces.slice(0, -2).every(p => !p.endsWith("\n") && pieces[pieces.indexOf(p) + 1].startsWith("\n")));

  console.log(`✅ volume: all checks passed (limit ${MAX_REQUEST_CHARS.toLocaleString("en-US")} chars per request)`);
}
main().catch(e => { console.error("❌ volume test failed:", e); process.exit(1); });
