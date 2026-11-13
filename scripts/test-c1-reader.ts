// Code test (no LLM): the 1C reader against the mock base.   npm run test:1c
import assert from "node:assert/strict";
process.env.LLM_API_KEY ||= "test";

async function main() {
  const { startMock1C } = await import("../services/mock-1c/server");
  const { readC1Snapshot, assertAllowedC1Address, monthsOf, C1Error } = await import("../lib/c1-reader");
  const { quoteDocument } = await import("../lib/doc-billing");
  const { parseFile } = await import("../lib/file-parser");
  const { MAX_REQUEST_CHARS } = await import("../lib/volume");

  // 1. Addresses: internal and local ones are refused unless explicitly allowed.
  delete process.env.C1_ALLOW_PRIVATE_HOSTS;
  for (const bad of ["http://localhost:8081", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.10", "http://169.254.169.254", "http://[::1]:80", "ftp://1c.example.ru", "http://user:pw@8.8.8.8", "не адрес"]) {
    await assert.rejects(assertAllowedC1Address(bad), C1Error, bad);
  }
  assert.equal((await assertAllowedC1Address("https://8.8.8.8/base")).hostname, "8.8.8.8");
  assert.deepEqual(monthsOf({ from: "2025-11-13", to: "2026-01-05" }).map(m => m.start.slice(0, 10) + ".." + m.end.slice(0, 10)),
    ["2025-11-13..2025-11-30", "2025-12-01..2025-12-31", "2026-01-01..2026-01-05"]);

  const mock = await startMock1C({ port: 0, user: "odata.user", password: "s3cret", baseName: "ea/4304534" });
  const root = mock.url.replace("/ea/4304534/odata/standard.odata", "");
  const config = { url: root + "/ea", base: "4304534", username: "odata.user", password: "s3cret" };
  try {
    await assert.rejects(readC1Snapshot(config, { from: "2025-01-01", to: "2025-12-31" }), /недоступен для подключения/, "local address refused by default");
    process.env.C1_ALLOW_PRIVATE_HOSTS = "true";

    // 2. Wrong password, wrong base: clear messages, no data.
    await assert.rejects(readC1Snapshot({ ...config, password: "wrong" }, { from: "2025-01-01", to: "2025-12-31" }), /не приняла логин или пароль/);
    await assert.rejects(readC1Snapshot({ ...config, base: "нет-такой" }, { from: "2025-01-01", to: "2025-12-31" }), /не найдена база 1С/);

    // 3. The year.
    const snap = await readC1Snapshot(config, { from: "2025-01-01", to: "2025-12-31" });
    const base = mock.base;
    const postedDocs = Object.entries(base.sets).filter(([n]) => n.startsWith("Document_"))
      .flatMap(([, rows]) => rows).filter(r => r.Posted && String(r.Date).startsWith("2025"));
    assert.equal(snap.documentCount, postedDocs.length, "one operation per posted document of the period");
    assert.equal(snap.documentCount, 760);
    assert.equal(snap.operationKeys.length, snap.documentCount);
    assert.equal(new Set(snap.operationKeys).size, snap.operationKeys.length, "no two documents share a billing key");
    assert.equal(snap.organisation.inn, "7700123456");
    assert.ok(!snap.text.includes("s3cret") && !JSON.stringify(snap).includes("s3cret"), "the password is not in the snapshot");
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/.test(snap.text), "internal 1C identifiers are not shown to the model");

    const t = snap.text;
    const line = (re: RegExp) => t.split("\n").find(l => re.test(l)) ?? "";
    // Facts computed by 1C / code.
    assert.match(t, /Итого обороты: Дт [\d ]+,\d\d, Кт [\d ]+,\d\d — РАВНЫ\./);
    assert.match(line(/^- Оборот Дт 51/), /СОВПАДАЕТ/);
    assert.match(line(/^- Оборот Кт 51/), /СОВПАДАЕТ/);
    assert.match(line(/^51;/), /^51;Расчетные счета;Дт 2 400 000,00;/);

    // Every planted error is visible in the snapshot as a FACT (the conclusions are the model's job).
    assert.match(line(/64 380,50 × 2/), /Бумажный Двор.*14\.05\.2025, 29\.05\.2025.*20781/, "double payment listed among repeated payments");
    assert.match(line(/^- ООО "Меридиан-Сервис"; ИНН/), /оплачено 480 000,00/, "paid supplier with no incoming documents");
    assert.match(line(/^60\.01;ООО "Меридиан-Сервис"/), /Дт 480 000,00$/, "…and its debit balance on 60.01");
    assert.match(line(/^ИП Глебов Арсений Маркович;да;6;600 000,00/), /ОплатаПоставщику/);
    assert.match(line(/^Сафонова Милена Робертовна;нет;6;240 000,00/), /ПрочееСписание/);
    assert.match(line(/^58\.03;Лаптев Родион Аркадьевич/), /Дт 900 000,00$/, "director's loan outstanding");
    assert.ok(t.includes("Выплата дивидендов по решению участника") && !/НДФЛ.*дивиденд/i.test(t.split("=== ПРОВОДКИ")[0].split("9. Перечисления")[1]), "dividends paid; no НДФЛ payment for them among tax payments");
    assert.match(t, /5\. Непроведённые документы за период[^\n]*: 1\.\n- Реализация товаров и услуг № ВТРТ-\d+ от 12\.11\.2025; АО "Городские Аптеки"; 312 400,00/);
    assert.ok(!t.includes("ошибочный ввод"), "a document marked for deletion is ignored");
    const usn = t.split("\n").filter(l => /^\d\d\.\d\d\.2025;[\d ]+,\d\d;Единый налоговый платеж \(авансовый платеж по УСН/.test(l));
    assert.deepEqual(usn.map(l => l.slice(3, 5)), ["04", "10"], "УСН payments: April and October only");
    assert.match(line(/^68\.12;/), /;55 000,00;178 120,00;Кт 123 120,00$/, "accrued 178 120 (three advances and the year's tax), paid 55 000: the half-year advance of 30 000 is unpaid");
    assert.match(line(/^41\.01;/), /;Дт [\d ]+,\d\d$/, "goods end with a debit balance");
    for (const a of ["44\\.01", "90\\.01\\.1", "90\\.02\\.1", "90\\.07\\.1", "90\\.09", "91\\.02", "91\\.09", "99\\.01"]) {
      assert.match(line(new RegExp(`^${a};`)), /;0,00$/, `account ${a} is closed at year end`);
    }
    assert.match(t, /Такой случай — признак риска \(документ нужно запросить\), а не подтверждённое нарушение/);

    // Data sections are complete.
    const section = (title: string) => t.split(`=== ${title}`)[1].split("\n===")[0].trim().split("\n").slice(2).filter(Boolean);
    assert.equal(section("ПРОВОДКИ ЗА ПЕРИОД").length, base.ledger.filter(r => String(r.Period).startsWith("2025")).length);
    assert.equal(section("БАНКОВСКИЕ ДОКУМЕНТЫ (проведённые)").length, 163 + 242);

    // Individuals known by field are handed over for coding.
    for (const n of ["Лаптев Родион Аркадьевич", "Жданова Таисия Львовна", "Сафонова Милена Робертовна", "Глебов Арсений Маркович", "Орехов Тимофей Ильич"]) {
      assert.ok(snap.personNames.includes(n), n);
    }
    assert.ok(!snap.personNames.some(n => /ООО|АО/.test(n)), "companies are not individuals");

    // 4. A quarter reads only that quarter; opening balances come from before it.
    const q2 = await readC1Snapshot(config, { from: "2025-04-01", to: "2025-06-30" });
    assert.equal(q2.documentCount, postedDocs.filter(r => String(r.Date) >= "2025-04-01" && String(r.Date) < "2025-07-01").length);
    assert.ok(q2.documentCount > 150 && q2.documentCount < 250);
    assert.ok(!/^51;Расчетные счета;Дт 2 400 000,00;/m.test(q2.text) && /^51;Расчетные счета;Дт /m.test(q2.text));

    // 5. As a stored document: parsed like a file, priced per document, bank lines match a statement file.
    const stored = new TextEncoder().encode(JSON.stringify(snap)).buffer as ArrayBuffer;
    const parsed = await parseFile(stored, "1c_odata");
    assert.equal(parsed.textContent, snap.text);
    assert.equal(parsed.rowCount, 760);
    assert.deepEqual(parsed.personNames, snap.personNames);
    const quote = quoteDocument({ fileType: "1c_odata", parsed, knownKeys: new Map(), sameFileAlreadyAccepted: false, operationRateRub: 12.5, pageRateRub: 20 });
    assert.deepEqual([quote.kind, quote.units, quote.amountRub], ["operations", 760, 9500]);
    const K = await import("../lib/operation-keys");
    const firstOut = base.sets["Document_СписаниеСРасчетногоСчета"][0];
    assert.ok(snap.operationKeys.includes(K.numberedKey(firstOut.НомерВходящегоДокумента, String(firstOut.Date).slice(0, 10), firstOut.СуммаДокумента)),
      "a bank document has the same billing key as that payment in a statement file");
    assert.ok(snap.text.length < MAX_REQUEST_CHARS / 3, `a year of ~750 documents is well inside one request (${snap.text.length} chars)`);

    // 6. Coding: with the names known by field, no individual is left in what goes to the model.
    const { Pseudonymizer } = await import("../lib/pseudonymize");
    const pz = new Pseudonymizer();
    for (const n of snap.personNames) pz.learnDetectedName(n);
    const [coded] = pz.encodeRequest([snap.text]);
    for (const w of ["Лаптев", "Жданова", "Ершов", "Сафонова", "Глебов", "Орехов", "Родион", "Милена", "Ильич", "773100011122", "500300077766", "771400088899"]) {
      assert.ok(!coded.includes(w), `"${w}" must not reach the model`);
    }
    assert.ok(coded.includes('ООО "Бумажный Двор"') && coded.includes("7700123456"), "companies and their ИНН stay readable");
    assert.equal(pz.restore(coded), snap.text, "exact restore");

    console.log(`✅ 1C reader: all checks passed (${snap.documentCount} documents → ${snap.text.length.toLocaleString("en-US")} chars; all 8 planted errors visible as facts)`);
  } finally {
    await mock.close();
  }
}
main().catch(e => { console.error("❌ 1C reader test failed:", e); process.exit(1); });
