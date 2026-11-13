// Code test (no LLM, no database): stage 2 — what the agent is shown about
// existing findings, and validation of what it sends back.
//   npm run test:findings
import assert from "node:assert/strict";
process.env.LLM_API_KEY ||= "test";

async function main() {
  const { buildFindingsBlock, validateUpdates, findingCode, UPDATE_FINDINGS_TOOL } = await import("../lib/finding-updates");
  type F = Parameters<typeof buildFindingsBlock>[0][number];
  const f = (i: number, over: Partial<F> = {}): F => ({
    id: `id-${i}`, code: findingCode(i), title: `Вывод ${i + 1}`, description: "Описание вывода", recommendation: "Запросить документы",
    risk_level: "СУЩЕСТВЕННО", evidence_status: "risk_flag", status: "open", proposed: false, agent_note: null, ...over,
  });

  // 1. No findings yet → nothing is added to the request (a first analysis runs as before).
  assert.equal(buildFindingsBlock([]), "");

  // 2. The block lists open findings with codes, and closed ones separately.
  const list = [
    f(0, { title: "Аванс ООО «Меридиан-Сервис» 480 000,00 без документов" }),
    f(1, { title: "Двойная оплата счёта № 20781", proposed: true }),
    f(2, { title: "НДФЛ с дивидендов не удержан", status: "resolved" }),
    f(3, { title: "Услуги ИП без актов", agent_note: "Нет актов за октябрь и декабрь на 200 000,00." }),
  ];
  const block = buildFindingsBlock(list);
  assert.match(block, /ОТКРЫТЫЕ ВЫВОДЫ \(3\):/);
  assert.match(block, /\[Н-1\] СУЩЕСТВЕННО · Признак риска · Аванс ООО «Меридиан-Сервис»/);
  assert.match(block, /\[Н-2\][^\n]*\n[^\n]*\n[^\n]*\n\s+Состояние: закрытие уже предложено/);
  assert.match(block, /ЗАКРЫТЫЕ ВЫВОДЫ \(1\)[^\n]*\n\[Н-3\] НДФЛ с дивидендов/);
  assert.match(block, /Ранее ты указал, чего не хватает: Нет актов за октябрь и декабрь/);
  // The rules that matter most are in it.
  for (const rule of [/Ты только ПРЕДЛАГАЕШЬ закрытие/, /Решение принимает клиент/, /Только договор, только счёт или только счёт-фактура — недостаточно/,
    /Счёт или счёт-фактура на первую поставку основанием не являются/, /только слова клиента без документа/, /изображение или скан без распознанного текста/,
    /При сомнении — keep_open/, /НЕ восемь разделов отчёта/, /Существующие выводы через record_findings не повторяй/]) {
    assert.match(block, rule);
  }
  // A declined proposal is shown as such, with the rule for reconsidering on request.
  const withDeclined = buildFindingsBlock([f(0, { declined: { at: "13.11.2026", basis: "Справка НПД и 6 чеков покрывают все выплаты." } })]);
  assert.match(withDeclined, /клиент ОТКЛОНИЛ твоё предложение закрыть этот вывод \(13\.11\.2026\)\. Основание того предложения: Справка НПД/);
  assert.match(withDeclined, /8\. Пересмотр по просьбе клиента\./);
  assert.match(withDeclined, /не повод ослабить требования к документам/);

  // A long description does not flood the request.
  assert.ok(buildFindingsBlock([f(0, { description: "д".repeat(5000) })]).length - buildFindingsBlock([f(0)]).length < 750);

  // 3. The tool can only propose or keep open — there is no "close" action.
  const actions = (UPDATE_FINDINGS_TOOL.input_schema as any).properties.updates.items.properties.action.enum;
  assert.deepEqual(actions, ["propose_close", "keep_open"]);

  // 4. Validation of the agent's answer.
  const { valid, skipped } = validateUpdates([
    { finding: "Н-1", action: "propose_close", basis: "Договор № 3 от 01.03.2025 и акты № 1–3 на 480 000,00.", documents: ["dogovor.pdf", "akty.pdf"], remaining: "что-то" },
    { finding: "[H-4]", action: "keep_open", basis: "Акты представлены за четыре из шести месяцев.", remaining: "Акты за октябрь и декабрь на 200 000,00." },   // Latin H, brackets
    { finding: "Н-3", action: "propose_close", basis: "Платёжное поручение на 156 000,00." },      // already closed
    { finding: "Н-9", action: "propose_close", basis: "Какой-то документ подтверждает." },        // no such finding
    { finding: "Н-2", action: "close", basis: "Закрываю сам, без клиента." },                     // not an allowed action
    { finding: "Н-2", action: "propose_close", basis: "ок" },                                     // no real basis
    { finding: "Н-1", action: "keep_open", basis: "Передумал, оставляю открытым вывод." },         // repeated code
    null,
  ], list);
  assert.deepEqual(valid.map(v => [v.code, v.action]), [["Н-1", "propose_close"], ["Н-4", "keep_open"]]);
  assert.equal(valid[0].findingId, "id-0");
  assert.equal(valid[0].remaining, "", "nothing is 'remaining' on a closing proposal");
  assert.deepEqual(valid[0].documents, ["dogovor.pdf", "akty.pdf"]);
  assert.equal(valid[1].remaining, "Акты за октябрь и декабрь на 200 000,00.");
  assert.equal(skipped.length, 6);
  assert.ok(skipped.some(s => /Н-3: вывод уже закрыт/.test(s)) && skipped.some(s => /Н-9: нет такого вывода/.test(s)) && skipped.some(s => /Н-1: повтор/.test(s)));

  // 5. Safety net: proposals written in the answer text without a tool call (a real reply, 13.11.2026).
  const { proposalsFromText } = await import("../lib/finding-updates");
  const reply = [
    "**Что проверено** Повторно сопоставлен вывод Н-7 со всеми документами аудита (файл safonova_spravka_npd_i_cheki.pdf).",
    "",
    "**Н-7 · Выплаты Сафоновой Милене Робертовне 240 тыс. ₽ без актов, НДФЛ и взносов** — предлагаю закрыть. Основание вывода устранено полностью:",
    "- Справка подтверждает статус плательщика НПД с 01.07.2025 — до первой выплаты 21.07.2025;",
    "- шесть чеков НПД покрывают все шесть платежей по 40 000,00 ₽ (файл safonova_spravka_npd_i_cheki.pdf);",
    "",
    "Н-9 · Услуги ИП — остаётся открытым. Акт № 5 на 90 000,00 ₽ не сходится с оплатой.",
    "**Новые выводы** Нет.",
  ].join("\n");
  const fromText = proposalsFromText(reply);
  assert.equal(fromText.length, 1);
  assert.equal(fromText[0].finding, "Н-7");
  assert.match(fromText[0].basis, /^Основание вывода устранено полностью: Справка подтверждает статус плательщика НПД .* шесть чеков НПД покрывают/);
  assert.ok(!fromText[0].basis.includes("Н-9") && !fromText[0].basis.includes("**"));
  assert.deepEqual(fromText[0].documents, ["safonova_spravka_npd_i_cheki.pdf"]);
  const seven = Array.from({ length: 7 }, (_, i) => f(i));
  assert.deepEqual(validateUpdates(fromText, seven).valid.map(v => [v.code, v.action]), [["Н-7", "propose_close"]]);
  assert.equal(proposalsFromText("Н-9 — остаётся открытым. Вывод Н-3 закрыт ранее. Предлагаю закрыть вопрос позже.").length, 0, "only an explicit 'Н-… — предлагаю закрыть' counts");
  assert.match(buildFindingsBlock([f(0)]), /без вызова инструмента клиент не увидит предложения/);

  // A reply cut at a tool call is finished by a second call (lib/audit-engine.ts).
  const { looksUnfinished } = await import("../lib/audit-engine");
  assert.equal(looksUnfinished(""), true);
  assert.equal(looksUnfinished("подтверждение уплаты аванса УСН за полугодие 30 000,00 ₽ (Н-10), пла"), true);
  assert.equal(looksUnfinished("договор займа № 1-3 с подтверждением возврата (Н-6)."), false);
  assert.equal(looksUnfinished("**Новые выводы:** нет.  "), false);
  assert.equal(looksUnfinished("| Н-1 | закрыт |"), false);

  console.log("✅ findings (stage 2): all checks passed (block shown to the agent, closing rules present, validation of proposals)");
}
main().catch(e => { console.error("❌ findings test failed:", e); process.exit(1); });
