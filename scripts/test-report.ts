// Code test (no browser): the PDF report definition — counts, conclusion, states, text cleaning.
//   npm run test:report
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";

async function main() {
  const R = await import("../lib/report-pdf");
  const f = (i: number, x: any = {}) => ({ id: `f${i}`, title: `Вывод ${i}`, risk_level: "СУЩЕСТВЕННО", status: "open", ...x });
  const list = [
    f(1, { status: "resolved", resolution_kind: "corrected" }),
    f(2, { status: "resolved" }),                                   // closed before migration 008 → documented
    f(3), f(4, { risk_level: "НЕСУЩЕСТВЕННО" }), f(5, { risk_level: "КРИТИЧНО", proposed_at: "2026-11-13" }),
  ];
  const c = R.reportCounts(list as any);
  assert.deepEqual(c, { total: 5, open: 3, closed: 2, critical: 1, material: 1, minor: 1, corrected: 1, documented: 1 });
  const k = R.conclusion(c);
  assert.equal(k.verdict, "Выявлены критичные нарушения");
  assert.match(k.text, /Закрыто 2 из 5: нарушение устранено — 1, по подтверждающим документам — 1\./);
  assert.equal(R.conclusion(R.reportCounts([f(1, { status: "resolved" })] as any)).verdict, "Все нарушения закрыты");
  assert.equal(R.conclusion(R.reportCounts([] as any)).verdict, "Нарушений не выявлено");
  assert.equal(R.conclusion(R.reportCounts([f(1, { risk_level: "НЕСУЩЕСТВЕННО" })] as any)).color, R.C.blue);

  // Colour language: corrected and documented are both green but not the same mark.
  const corrected = R.findingState(list[0] as any), documented = R.findingState(list[1] as any);
  assert.equal(corrected.label, "Нарушение устранено"); assert.equal(corrected.solid, true);
  assert.equal(documented.label, "Закрыто по документам"); assert.equal(documented.solid, false);
  assert.equal(corrected.color, R.C.green); assert.equal(documented.color, R.C.green);
  assert.equal(R.findingState(list[4] as any).label, "Ожидает решения");
  assert.equal(R.findingState(list[2] as any).color, R.C.orange);
  assert.equal(R.findingState(list[3] as any).color, R.C.blue);

  // Characters the font cannot print are replaced, not shown as boxes.
  assert.equal(R.pdfText("НЕСУЩЕСТВЕННО → СУЩЕСТВЕННО ✓ ⚠ 📌"), "НЕСУЩЕСТВЕННО › СУЩЕСТВЕННО !");
  assert.equal(R.ruPeriod("2025-01-01 – 2025-12-31"), "01.01.2025 – 31.12.2025");

  // The definition builds, has the summary and one card per finding.
  const def = R.buildReportDefinition({ company_name: "ООО Тест", period: "2025-01-01 – 2025-12-31", created_at: "2026-11-13T09:00:00Z",
    transactions_ct: 760, cost_rub: 8500 }, list as any, new Date("2026-11-13T12:00:00Z"));
  const json = JSON.stringify(def.content);
  for (const s of ["ОТЧЁТ ОБ АУДИТЕ", "ИТОГОВОЕ ЗАКЛЮЧЕНИЕ", "СВОДНЫЙ РЕЕСТР НАРУШЕНИЙ", "ПОДРОБНЫЙ РЕЕСТР НАРУШЕНИЙ", "8 500 ₽", "01.01.2025 – 31.12.2025"]) assert.ok(json.includes(s), s);
  for (let i = 1; i <= 5; i++) assert.ok(json.includes(`"Н-${i}"`), `Н-${i}`);
  console.log("✅ report: all checks passed (counts, conclusion, colour states, corrected vs documented, text cleaning)");
}
main().catch(e => { console.error("❌ report test failed:", e); process.exit(1); });
