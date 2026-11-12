// Code test (no LLM): the xlsx reader puts every value in the right cell.
//   npm run test:xlsx
// Covers what real exports do and a naive reader gets wrong: text stored
// inline, text with mixed formatting, empty cells left out of the file,
// dates stored as day numbers, and escaped characters.
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
process.env.LLM_API_KEY ||= "test";

const sheet = (rows: string) => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

async function main() {
  const { parseFile } = await import("../lib/file-parser");

  const sharedStrings = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <si><t>Дата</t></si>
    <si><t>Номер</t></si>
    <si><t>Контрагент</t></si>
    <si><t>Сумма</t></si>
    <si><t>Назначение</t></si>
    <si><r><rPr><b/></rPr><t>ООО </t></r><r><t xml:space="preserve">«Ромашка»</t></r></si>
    <si><t>Оплата по счёту &amp; акту &lt;№ 5&gt;</t></si>
    <si><t>ООО &quot;Лютик&quot;</t></si>
  </sst>`;
  // cellXfs: 0 = general, 1 = built-in date (14), 2 = custom date, 3 = money "#,##0.00"
  const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00\\ &quot;₽&quot;"/></numFmts>
    <cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`;
  const rows =
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>` +
    // rich-text string; string after it must not be shifted
    `<row r="2"><c r="A2" s="1"><v>45700</v></c><c r="B2"><v>17</v></c><c r="C2" t="s"><v>5</v></c><c r="D2" s="3"><v>1234.5600000000001</v></c><c r="E2" t="s"><v>6</v></c></row>` +
    // B and C left out of the file entirely; amount must stay in column D
    `<row r="3"><c r="A3" s="2"><v>45701</v></c><c r="D3" s="3"><v>500</v></c><c r="E3" t="inlineStr"><is><t>Комиссия банка</t></is></c></row>` +
    // self-closing empty cells, inline text with numeric character references
    `<row r="4"><c r="A4" s="1"><v>45702</v></c><c r="B4" s="1"/><c r="C4" t="s"><v>7</v></c><c r="D4" s="3"><v>75.5</v></c><c r="E4" t="inlineStr"><is><r><t>&#1040;&#1088;&#1077;&#1085;&#1076;&#1072;</t></r><r><t xml:space="preserve"> за март</t></r></is></c></row>`;

  const xlsx = zipSync({
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Выписка" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/sharedStrings.xml": strToU8(sharedStrings),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(sheet(rows)),
  });
  const r = await parseFile(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer, "xlsx");
  const lines = r.textContent!.split("\n").filter(l => l.includes(";"));

  assert.equal(lines[0], "Дата;Номер;Контрагент;Сумма;Назначение");
  assert.equal(lines[1], "12.02.2025;17;ООО «Ромашка»;1234.56;Оплата по счёту & акту <№ 5>", "rich text joined, entities decoded, date and number readable");
  assert.equal(lines[2], "13.02.2025;;;500;Комиссия банка", "cells missing from the file leave their columns empty");
  assert.equal(lines[3], '14.02.2025;;ООО "Лютик";75.5;Аренда за март', "empty cells and inline text");
  assert.equal(r.rowCount, 3);
  assert.equal(r.operationKeys!.length, 3);
  assert.ok(r.operationKeys![0].startsWith("n|17|2025-02-12|1234.56"));

  // The audit period now filters on real dates (a day number used to pass any filter).
  const feb13 = await parseFile(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer, "xlsx",
    { dateFrom: "2025-02-13", dateTo: "2025-02-13" });
  assert.equal(feb13.rowCount, 1);
  assert.ok(feb13.textContent!.includes("Комиссия банка") && !feb13.textContent!.includes("Ромашка"));

  console.log("✅ xlsx reader: all checks passed (inline text, mixed formatting, missing cells, dates, escaped characters)");
}
main().catch(e => { console.error("❌ xlsx test failed:", e); process.exit(1); });
