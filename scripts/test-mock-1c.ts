// Code test (no LLM): the mock 1C base answers like 1C's OData interface and
// its books are consistent.   npm run test:mock1c
import assert from "node:assert/strict";

async function main() {
  const { startMock1C } = await import("../services/mock-1c/server");
  const { STRUCTURE, ZERO_GUID } = await import("../services/mock-1c/data");
  const mock = await startMock1C({ port: 0, user: "odata.user", password: "s3cret", baseName: "ea/4304534" });
  const auth = { authorization: "Basic " + Buffer.from("odata.user:s3cret").toString("base64") };
  const get = async (path: string, headers: Record<string, string> = auth) => {
    const res = await fetch(mock.url + "/" + encodeURI(path).replace(/'/g, "%27"), { headers });
    const text = await res.text();
    return { status: res.status, type: res.headers.get("content-type") ?? "", text, json: () => JSON.parse(text) };
  };

  try {
    // 1. Access: no login / wrong login → 401 with a Basic challenge.
    assert.equal((await get("$metadata", {})).status, 401);
    assert.equal((await get("$metadata", { authorization: "Basic " + Buffer.from("odata.user:nope").toString("base64") })).status, 401);

    // 2. The structure file is served and names the real objects.
    const meta = await get("$metadata");
    assert.equal(meta.status, 200);
    assert.ok(meta.type.includes("xml") && meta.text.includes('EntityType Name="Document_СписаниеСРасчетногоСчета"') && meta.text.includes('FunctionImport Name="BalanceAndTurnovers"'));

    // 3. A collection: every field of the real type is present, with 1C's empty values.
    const outs = (await get("Document_СписаниеСРасчетногоСчета?$format=json&$top=3&$inlinecount=allpages")).json();
    assert.equal(outs.value.length, 3);
    assert.ok(Number(outs["odata.count"]) > 200);
    assert.deepEqual(Object.keys(outs.value[0]).sort(), Object.keys(STRUCTURE["Document_СписаниеСРасчетногоСчета"].props).sort());
    assert.equal(outs.value[0].Налог_Key, ZERO_GUID);
    assert.match(outs.value[0].Date, /^2025-\d\d-\d\dT\d\d:\d\d:\d\d$/);
    assert.match(outs["odata.metadata"], /\/ea\/4304534\/odata\/standard\.odata\/\$metadata#Document_СписаниеСРасчетногоСчета$/);

    // 4. $filter (dates, guid, bool, and/or, substringof), $select, $orderby, paging, $count.
    const march = "Date ge datetime'2025-03-01T00:00:00' and Date le datetime'2025-03-31T23:59:59'";
    const cnt = Number((await get(`Document_СписаниеСРасчетногоСчета/$count?$filter=${march} and Posted eq true`)).text);
    const page1 = (await get(`Document_СписаниеСРасчетногоСчета?$format=json&$filter=${march} and Posted eq true&$select=Ref_Key,Date,СуммаДокумента,НазначениеПлатежа&$orderby=Date desc&$top=5`)).json().value;
    const page2 = (await get(`Document_СписаниеСРасчетногоСчета?$format=json&$filter=${march} and Posted eq true&$select=Ref_Key,Date&$orderby=Date desc&$top=5&$skip=5`)).json().value;
    assert.ok(cnt > 10 && page1.length === 5 && page2.length === 5);
    assert.deepEqual(Object.keys(page1[0]), ["Ref_Key", "Date", "СуммаДокумента", "НазначениеПлатежа"]);
    assert.ok(page1[0].Date >= page1[4].Date && page1[4].Date >= page2[0].Date && page1.every((r: any) => r.Date.startsWith("2025-03")));
    assert.ok(!page1.some((a: any) => page2.some((b: any) => a.Ref_Key === b.Ref_Key)));
    const consult = (await get("Catalog_Контрагенты?$format=json&$filter=ИндивидуальныйПредприниматель eq true and substringof('глебов', Description)")).json().value;
    assert.equal(consult.length, 1);
    const byParty = (await get(`Document_СписаниеСРасчетногоСчета?$format=json&$filter=Контрагент eq '${consult[0].Ref_Key}' or СуммаДокумента gt 1000000`)).json().value;
    assert.equal(byParty.filter((r: any) => r.Контрагент === consult[0].Ref_Key).length, 6);
    const one = (await get(`Catalog_Контрагенты(guid'${consult[0].Ref_Key}')?$format=json`)).json();
    assert.equal(one.ИНН, "500300077766");

    // 5. Errors look like 1C's.
    const bad = await get("Document_НетТакого?$format=json");
    assert.equal(bad.status, 404);
    assert.ok(bad.json()["odata.error"].message.value.includes("не найдена"));
    assert.equal((await get("Catalog_Контрагенты?$format=json&$filter=НетПоля eq 1")).status, 400);
    assert.equal((await fetch(mock.url + "/Catalog_Контрагенты", { method: "POST", headers: auth })).status, 405);

    // 6. The books are consistent.
    const year = "StartPeriod=datetime'2025-01-01T00:00:00',EndPeriod=datetime'2025-12-31T23:59:59'";
    const bt = (await get(`AccountingRegister_Хозрасчетный/BalanceAndTurnovers(${year})?$format=json`)).json().value;
    const sum = (rows: any[], f: string) => Math.round(rows.reduce((s, r) => s + r[f], 0) * 100) / 100;
    assert.equal(sum(bt, "СуммаOpeningBalance"), 0, "opening balances: debits equal credits");
    assert.equal(sum(bt, "СуммаTurnoverDr"), sum(bt, "СуммаTurnoverCr"), "turnovers: debits equal credits");
    assert.equal(sum(bt, "СуммаClosingBalance"), 0, "closing balances: debits equal credits");
    const chart = (await get("ChartOfAccounts_Хозрасчетный?$format=json&$select=Ref_Key,Code")).json().value;
    const key = (code: string) => chart.find((a: any) => a.Code === code).Ref_Key;
    const bank = bt.filter((r: any) => r.Account_Key === key("51"));
    const ins  = (await get("Document_ПоступлениеНаРасчетныйСчет?$format=json&$filter=Posted eq true&$select=СуммаДокумента")).json().value;
    const outsAll = (await get("Document_СписаниеСРасчетногоСчета?$format=json&$filter=Posted eq true&$select=СуммаДокумента")).json().value;
    assert.equal(sum(bank, "СуммаOpeningBalance"), 2_400_000);
    assert.equal(sum(bank, "СуммаTurnoverDr"), sum(ins, "СуммаДокумента"), "bank account debit turnover equals bank receipts");
    assert.equal(sum(bank, "СуммаTurnoverCr"), sum(outsAll, "СуммаДокумента"), "bank account credit turnover equals bank write-offs");
    assert.ok(sum(bank, "СуммаClosingBalance") > 0, "the bank account never ends below zero");
    const closing = (await get("AccountingRegister_Хозрасчетный/Balance(Period=datetime'2025-12-31T23:59:59')?$format=json")).json().value;
    assert.equal(sum(closing.filter((r: any) => r.Account_Key === key("51")), "СуммаBalance"), sum(bank, "СуммаClosingBalance"));
    const turns = (await get(`AccountingRegister_Hозрасчетный/Turnovers(${year})?$format=json`.replace("H", "Х"))).json().value;
    assert.equal(sum(turns, "СуммаTurnoverDr"), sum(bt, "СуммаTurnoverDr"));
    const only51 = (await get(`AccountingRegister_Хозрасчетный/BalanceAndTurnovers(${year},AccountCondition='Account_Key eq guid''${key("51")}''')?$format=json`)).json().value;
    assert.ok(only51.length >= 1 && only51.every((r: any) => r.Account_Key === key("51")));

    // 7. Postings: paging over the whole year returns each posting once, with its document.
    const total = Number((await get(`AccountingRegister_Хозрасчетный/RecordsWithExtDimensions(${year})?$format=json&$top=1&$inlinecount=allpages`)).json()["odata.count"]);
    const seen = new Set<string>();
    for (let skip = 0; skip < total; skip += 400) {
      const rows = (await get(`AccountingRegister_Хозрасчетный/RecordsWithExtDimensions(${year})?$format=json&$top=400&$skip=${skip}`)).json().value;
      for (const r of rows) seen.add(r.Recorder + "#" + r.LineNumber);
      assert.ok(rows.every((r: any) => /^StandardODATA\.Document_/.test(r.Recorder_Type) && r.Period.startsWith("2025")));
    }
    assert.equal(seen.size, total);
    assert.equal(total, mock.base.ledger.filter(r => String(r.Period).startsWith("2025")).length);

    // 8. The planted errors are really in the data, and visible through the interface.
    const planted = Object.fromEntries(mock.base.planted.map(p => [p.id, p]));
    assert.deepEqual(Object.keys(planted).sort(), ["director-loan", "dividends-no-ndfl", "double-payment", "individual-no-tax", "no-documents", "round-consulting", "unposted-sale", "usn-q2-missing"]);
    const dbl = (await get("Document_СписаниеСРасчетногоСчета?$format=json&$filter=substringof('20781', НазначениеПлатежа)")).json().value;
    assert.equal(dbl.length, 2);
    assert.ok(dbl[0].СуммаДокумента === dbl[1].СуммаДокумента && dbl[0].Контрагент === dbl[1].Контрагент && dbl[0].Date !== dbl[1].Date);
    assert.equal((await get("Document_ПоступлениеТоваровУслуг?$format=json&$filter=НомерВходящегоДокумента eq '20781'")).json().value.length, 1);
    const ghost = (await get("Catalog_Контрагенты?$format=json&$filter=ИНН eq '9705000112'")).json().value[0];
    assert.equal((await get(`Document_ПоступлениеТоваровУслуг/$count?$filter=Контрагент_Key eq guid'${ghost.Ref_Key}'`)).text, "0");
    const ghostBalance = closing.filter((r: any) => r.Account_Key === key("60.01") && r.ExtDimension1 === ghost.Ref_Key);
    assert.equal(sum(ghostBalance, "СуммаBalance"), 480_000, "paid supplier with no documents shows as a debit balance on 60.01");
    const usn = (await get("Document_СписаниеСРасчетногоСчета?$format=json&$filter=substringof('по УСН', НазначениеПлатежа)&$select=Date")).json().value;
    assert.deepEqual(usn.map((r: any) => r.Date.slice(5, 7)), ["04", "10"]);
    assert.equal(sum(closing.filter((r: any) => r.Account_Key === key("68.12")), "СуммаBalance"), -123_120, "68.12 ends in credit: the unpaid half-year advance (30 000) and the year's tax not yet due (93 120)");
    const beforeYearTax = (await get("AccountingRegister_Хозрасчетный/Balance(Period=datetime'2025-12-31T23:00:00')?$format=json")).json().value;
    assert.equal(sum(beforeYearTax.filter((r: any) => r.Account_Key === key("68.12")), "СуммаBalance"), -30_000, "before the year's tax is accrued, only the unpaid half-year advance is owed");
    // No accidental errors: injury insurance is accrued monthly and paid; only December's is outstanding.
    assert.equal(sum(closing.filter((r: any) => r.Account_Key === key("69.11")), "СуммаBalance"), -550);
    // No accidental errors: bank documents never fall on a weekend.
    for (const set of ["Document_ПоступлениеНаРасчетныйСчет", "Document_СписаниеСРасчетногоСчета"]) {
      for (const r of mock.base.sets[set]) {
        const wd = new Date(String(r.Date).slice(0, 10) + "T00:00:00Z").getUTCDay();
        assert.ok(wd !== 0 && wd !== 6 && String(r.Date).startsWith("2025"), `${set} dated ${r.Date}`);
      }
    }
    // No accidental errors: goods never go below zero.
    let stock = 0, minStock = Infinity;
    for (const r of mock.base.ledger) {
      if (r.AccountDr_Key === key("41.01")) stock += Number(r.Сумма);
      if (r.AccountCr_Key === key("41.01")) stock -= Number(r.Сумма);
      minStock = Math.min(minStock, stock);
    }
    assert.ok(minStock >= 0 && stock > 0, `stock on 41.01 never goes below zero (lowest ${Math.round(minStock)})`);
    const unposted = (await get("Document_РеализацияТоваровУслуг?$format=json&$filter=Posted eq false and DeletionMark eq false")).json().value;
    assert.equal(unposted.length, 1);
    assert.equal(unposted[0].СуммаДокумента, 312_400);
    assert.equal(sum(closing.filter((r: any) => r.Account_Key === key("58.03")), "СуммаBalance"), 900_000);
    const ndfl = (await get(`AccountingRegister_Хозрасчетный/RecordsWithExtDimensions(${year},Condition='AccountCr_Key eq guid''${key("68.01")}''')?$format=json`)).json().value;
    assert.ok(ndfl.length === 12 && ndfl.every((r: any) => r.Содержание === "НДФЛ с заработной платы"), "НДФЛ is accrued on salary only — none on dividends");

    // 9. The same year is the same data (tests and audits can be compared run to run).
    const { buildBase } = await import("../services/mock-1c/data");
    assert.equal(JSON.stringify(buildBase().ledger), JSON.stringify(mock.base.ledger));
    assert.ok(buildBase(2025, 4).ledger.length > mock.base.ledger.length * 3, "scale gives a larger base for volume tests");

    const docs = Object.entries(mock.base.sets).filter(([n]) => n.startsWith("Document_")).reduce((s, [, r]) => s + r.length, 0);
    console.log(`✅ mock 1C: all checks passed (${docs} documents, ${mock.base.ledger.length} postings, ${mock.base.planted.length} planted errors)`);
  } finally {
    await mock.close();
  }
}
main().catch(e => { console.error("❌ mock 1C test failed:", e); process.exit(1); });
