/**
 * scripts/test-pseudonymize.ts — code test for lib/pseudonymize.ts and its
 * wiring in lib/audit-engine.ts. No network, no LLM:   npm run test:pii
 *
 * All names and numbers here are invented. The key test is the LEAK SCAN:
 * a full audit turn is run against a fake model that records exactly what
 * would have been sent, and that payload is searched for personal values.
 */
process.env.LLM_API_KEY ??= "test-key-not-used";
// The test exercises the full draft + review flow with coding on, whatever
// the server's own settings are (e.g. LLM_REVIEW=disabled in Coolify).
delete process.env.LLM_REVIEW;
delete process.env.LLM_PSEUDONYMIZE;
delete process.env.NER_URL;   // sections 1–2 test the built-in rules; the name service is tested in section 3
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const { Pseudonymizer, PseudonymizationError } = await import("../lib/pseudonymize");
  const { parseFile } = await import("../lib/file-parser");
  const { llm, AUDIT_SYSTEM_PROMPT, buildAuditContext } = await import("../lib/llm");
  const { runAuditTurn } = await import("../lib/audit-engine");

  // ── 1. Coding rules ────────────────────────────────────────────────────────
  const cases: [string, string][] = [
    ["Под отчёт Иванову И.И. 5000, зарплата Петровой Анне Сергеевне, возврат займа Сидоров Пётр. Далее текст.",
     "Под отчёт [ФЛ_2] 5000, зарплата [ФЛ_1], возврат займа [ФЛ_3]. Далее текст."],
    ["ЗАРПЛАТА ЗА МАРТ ИВАНОВ ИВАН ИВАНОВИЧ НДС НЕ ОБЛАГАЕТСЯ", "ЗАРПЛАТА ЗА МАРТ [ФЛ_2] НДС НЕ ОБЛАГАЕТСЯ"],
    ["Перевод от Иван Иванович Иванов. Затем И.И. Иванов подписал акт; позже Иванова уволили, а Ивановым выдано 100 руб.",
     "Перевод от [ФЛ_2]. Затем [ФЛ_2] подписал акт; позже [ФЛ_2] уволили, а [ФЛ_2] выдано 100 руб."],
    // companies, company ИНН/КПП/account, amounts, dates, document numbers stay
    ['Оплата по договору № 15 от 01.02.2025 за услуги, в т.ч. НДС 20% 1 500,00. ООО "Вектор" ИНН 7701234567 КПП 770101001 р/с 40702810900000012345 БИК 044525225', ""],
    ["ИП Кузнецова Мария Петровна ИНН 500100732259 ОГРНИП 304500116000157 счет 40802810900000054321; физлицо счет 40817810099910004312",
     "ИП [ФЛ_4] ИНН [ИНН_ФЛ_1] ОГРНИП [ОГРНИП_1] счет [СЧЕТ_1:40802]; физлицо счет [СЧЕТ_2:40817]"],
    ["Выдача займа Марии Кузнецовой и Сергею Попову; Попов С. вернул часть.", "Выдача займа [ФЛ_4] и [ФЛ_5]; [ФЛ_5] вернул часть."],
    ["Сумма 123456789012.50 и 8 000 000,00 руб; дата 12.11.2025; счет-фактура № 83973/007; тел. 8-916-555-44-33",
     "Сумма 123456789012.50 и 8 000 000,00 руб; дата 12.11.2025; счет-фактура № 83973/007; тел. [ТЕЛ_1]"],
    ["Генеральный директор Смирнов-Задунайский А.В., бухгалтер Ли Ольга Викторовна", "Генеральный директор [ФЛ_7], бухгалтер [ФЛ_6]"],
    ["СНИЛС 123-456-789 01, паспорт серия 45 08 123456, карта 4276 3800 1234 5678 и 2204********7863, почта Ivan.P@example.ru",
     "СНИЛС [СНИЛС_1], паспорт серия [ПАСПОРТ_1], карта [КАРТА_2] и [КАРТА_1], почта [EMAIL_1]"],
  ];
  const pz = new Pseudonymizer();
  for (const c of cases) pz.learn(c[0]);
  const coded = cases.map(c => pz.encode(c[0]));
  coded.forEach((c, i) => assert.doesNotThrow(() => pz.verify(c), `verify case ${i + 1}: ${c}`));
  cases.forEach(([src, want], i) => assert.equal(coded[i], want || src, `case ${i + 1}`));

  // restore: identifiers come back exactly; a known person comes back as the fullest form seen
  assert.equal(pz.restore(coded[4]), cases[4][0]);
  assert.equal(pz.restore(coded[8]), cases[8][0]);
  assert.equal(pz.restore("счёт [СЧЁТ_1:40802] и [СЧЕТ_1]"), "счёт 40802810900000054321 и 40802810900000054321", "ё/е and missing suffix tolerated");
  assert.equal(pz.restore("Выплата [ФЛ_4]"), "Выплата Кузнецова Мария Петровна");
  assert.equal(pz.restore("кто такой [ФЛ_99]?"), "кто такой [ФЛ_99]?", "unknown code is left visible");
  assert.equal(pz.unknownTokens, 1);
  assert.deepEqual(pz.restoreDeep({ findings: [{ title: "Заём [ФЛ_5]", n: 1 }] }), { findings: [{ title: "Заём Попову Сергею", n: 1 }] });

  // streamed restore: a code split across chunks is never shown half-restored
  const full = coded.join("\n");
  for (let round = 0; round < 50; round++) {
    let acc = ""; const st = pz.stream(t => { acc += t; });
    for (let i = 0; i < full.length;) { const n = 1 + Math.floor(Math.random() * 9); st.push(full.slice(i, i + n)); i += n; }
    st.flush();
    assert.equal(acc, pz.restore(full), "stream restore equals whole-text restore");
  }

  // fail closed: a known value still present → error, with no personal data in the message
  assert.throws(() => pz.verify("перевод на 40802810900000054321"), PseudonymizationError);
  assert.throws(() => pz.verify("получатель Кузнецовой"), PseudonymizationError);
  try { pz.verify("ИНН 500100732259"); } catch (e) { assert.ok(!/5001|Кузнец/.test((e as Error).message), "error text carries no personal data"); }

  // ── 2. LEAK SCAN: full audit turn on the fixture, fake model records the payload ──
  const buf = fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "ip-ausn-statement.txt"));
  const parsed = await parseFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "1c_txt");
  const system = `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext({
    companyName: "ИП Тестов Т.Т.", periodFrom: "2025-11-01", periodTo: "2025-12-31", transactionCount: parsed.rowCount,
    legalForm: "ИП", taxRegime: "АУСН (Доходы)", vatStatus: "not_taxed",
    existingFindings: [{ title: "Заём Тестову Т.Т. без договора", risk_level: "СУЩЕСТВЕННО" }] as never,
  })}\n\n=== ЗАГРУЖЕННЫЕ ФИНАНСОВЫЕ ДОКУМЕНТЫ ===\n${parsed.textContent}\n=== КОНЕЦ ДОКУМЕНТОВ ===`;
  const messages = [
    { role: "user" as const, content: "Проведи аудит выписки ИП Тестова Теста Тестовича, мой телефон +7 916 000-11-22." },
    { role: "assistant" as const, content: "Что является приоритетом при проведении данного аудита?" },
    { role: "user" as const, content: "Налоговые риски. Обрати внимание на карту 427638******0003." },
  ];
  const PERSONAL = [/тестов/i, /Тест Тестович/i, /770000000011/, /40802810000000000001/, /40802810000000000002/,
    /427638\*+0003/, /2204\*+000[12]/, /916\D*000\D*11\D*22/];

  const sent: string[] = [];
  const report = (tag: string) => `## 1. Резюме аудитора\n${tag}: клиент ИП [ФЛ_1], ИНН [ИНН_ФЛ_1], счёт [СЧЕТ_1:40802], резервный счёт [СЧЕТ_2:40802], карта [КАРТА_1].\n` + "Текст отчёта. ".repeat(60);
  const scripts = [
    { thinking: "Смотрю операции [ФЛ_1] по счёту [СЧЕТ_1:40802]", text: report("ЧЕРНОВИК"), tool: [{ title: "Пополнения с карты [КАРТА_1]", description: "[ФЛ_1] вносил средства" }] },
    { thinking: "Проверяю вывод о [ФЛ_1]", text: report("ИТОГ"), tool: [{ title: "Пополнения с карты [КАРТА_1]", description: "[ФЛ_1], ИНН [ИНН_ФЛ_1]" }] },
  ];
  let call = 0;
  (llm.messages as unknown as { stream: unknown }).stream = (params: unknown) => {
    sent.push(JSON.stringify(params));
    const sc = scripts[call++]; const h: Record<string, (d: string) => void> = {};
    return { on(ev: string, fn: (d: string) => void) { h[ev] = fn; return this; },
      async finalMessage() {
        for (const part of sc.thinking.match(/[\s\S]{1,7}/g) ?? []) h.thinking?.(part);
        for (const part of sc.text.match(/[\s\S]{1,11}/g) ?? []) h.text?.(part);
        return { content: [{ type: "text", text: sc.text }, { type: "tool_use", name: "record_findings", input: { findings: sc.tool } }],
          stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } };
      } };
  };

  let shown = "", thinking = "";
  const originalLog = console.log; console.log = () => {};
  const res = await runAuditTurn(system, messages, {
    step: () => {}, text: d => { shown += d; }, thinking: d => { thinking += d; }, reset: () => { shown = ""; },
  }, new Pseudonymizer());
  console.log = originalLog;

  assert.equal(sent.length, 2, "draft + review calls");
  sent.forEach((payload, i) => {
    const text = JSON.parse(payload); const flat = JSON.stringify(text);
    for (const re of PERSONAL) assert.ok(!re.test(flat), `call ${i + 1}: outbound payload must not contain ${re}`);
    assert.ok(flat.includes("[ФЛ_1]") && flat.includes("[ИНН_ФЛ_1]") && flat.includes("[СЧЕТ_1:40802]"), "codes are present");
    assert.ok(flat.includes("ОБЕЗЛИЧЕННЫЕ ДАННЫЕ"), "model is told about the codes");
    // what must stay readable
    for (const keep of ["Тест-Поставщик", "2500000001", "40702810000000000003", "83973/007", "54 171,37", "Яндекс Маркет", "9704254424", "26.12.2025"])
      assert.ok(flat.includes(keep), `call ${i + 1}: "${keep}" must stay readable`);
    assert.ok(text.system.startsWith(AUDIT_SYSTEM_PROMPT), "static prompt is sent unchanged");
  });

  // …and everything coming back is real again
  for (const out of [shown, res.text]) {
    assert.ok(out.includes("ИТОГ: клиент ИП Тестов Тест Тестович, ИНН 770000000011, счёт 40802810000000000001, резервный счёт 40802810000000000002, карта 2204********0001."), "answer restored");
    assert.ok(!/\[(ФЛ|ИНН_ФЛ|СЧЕТ|КАРТА)_\d/.test(out), "no codes left in the answer");
  }
  assert.equal(shown, res.text);
  assert.ok(thinking.includes("Смотрю операции Тестов Тест Тестович по счёту 40802810000000000001") && !/\[ФЛ_1\]/.test(thinking), "thinking panel restored");
  assert.deepEqual(res.findings, [{ title: "Пополнения с карты 2204********0001", description: "Тестов Тест Тестович, ИНН 770000000011" }]);
  assert.equal(res.reviewed, "done");

  // ── 3. Names from the name-detection service (Natasha) ─────────────────────
  // Spans exactly as the service returns them (roles are assigned by our code).
  const pn = new Pseudonymizer();
  // "Контрагент" / "Верификационный" are real false positives the service returned on a bank report.
  for (const span of ["Сидоров", "Кузнецова", "Кот В.П.", "Шевчук", "Гусь Марине", "Сидоров Петр", "Марина", "Сергеевна", "Контрагент", "Верификационный"]) pn.learnDetectedName(span);
  const free = [
    'debit;01.02.2025;50000;ООО "Ромашка";7701234567;40702810900000012345;возврат займа Сидорову по договору 5',
    "debit;02.02.2025;30000;ВЫПЛАТА КУЗНЕЦОВОЙ ПОД ОТЧЕТ БЕЗ НДС",
    "Аванс Коту В.П.; дивиденды учредителю Шевчук; оплата Гусь Марине; позже Сидоров вернул 100, а Кузнецова отчиталась.",
  ];
  const freeCoded = pn.encodeRequest(free);
  assert.equal(freeCoded[0], 'debit;01.02.2025;50000;ООО "Ромашка";7701234567;40702810900000012345;возврат займа [ФЛ_1] по договору 5');
  assert.equal(freeCoded[1], "debit;02.02.2025;30000;ВЫПЛАТА [ФЛ_2] ПОД ОТЧЕТ БЕЗ НДС");
  assert.equal(freeCoded[2], "Аванс [ФЛ_3]; дивиденды учредителю [ФЛ_4]; оплата [ФЛ_5]; позже [ФЛ_1] вернул 100, а [ФЛ_2] отчиталась.");
  assert.equal(pn.stats.persons, 5, "a lone first name / patronymic is not a person; Кот = Коту");

  // Shapes found in a real ООО bank report (Nov 12, 2026): a name inside the
  // source text's own square brackets, and a card masked with plus signs.
  const pb = new Pseudonymizer();
  const [bracketed] = pb.encodeRequest(["Верификационный платеж legium.io/terms [ПЕТРОВА АННА СЕРГЕЕВНА +79650001122]. Перевод с карты 220015++++++0023 157710 RU\\CARD2CARD;Контрагент"]);
  assert.equal(bracketed, "Верификационный платеж legium.io/terms [[ФЛ_1] [ТЕЛ_1]]. Перевод с карты [КАРТА_1] 157710 RU\\CARD2CARD;Контрагент");
  assert.equal(pn.restore("Заём [ФЛ_1], аванс [ФЛ_3]"), "Заём Сидоров Петр, аванс Кот В.П.", "restored in the nominative form the service gave");

  // Service configured but unreachable → the audit is blocked, nothing is sent
  const { detectNames } = await import("../lib/ner-client");
  assert.equal(await detectNames(["текст"]), null, "service not configured → not used");
  process.env.NER_URL = "http://ner.example.com"; process.env.NER_TOKEN = "t";
  await assert.rejects(() => detectNames(["x"]), /https/, "plain http to a public host is refused");
  process.env.NER_URL = "http://127.0.0.1:9";   // nothing listens here
  await assert.rejects(() => detectNames(["оплата Сидорову"]), (e: Error) => e instanceof PseudonymizationError && !/Сидоров/.test(e.message));
  const before = sent.length;
  await assert.rejects(() => runAuditTurn(system, messages, { step: () => {}, text: () => {}, thinking: () => {}, reset: () => {} }, new Pseudonymizer()),
    PseudonymizationError);
  assert.equal(sent.length, before, "name service down → no call to the model at all");
  delete process.env.NER_URL; delete process.env.NER_TOKEN;

  // Short patronymics (Ильич, Фомич, Кузьмич…) — one person, exact restore.
  {
    const { Pseudonymizer: P } = await import("../lib/pseudonymize");
    for (const full of ["Орехов Тимофей Ильич", "Зуев Прохор Фомич", "Белова Агния Кузьминична", "Рябов Мирон Никитич"]) {
      const pz = new P();
      pz.learnDetectedName(full);
      const src = `62.01;ИП ${full};771400088899;оплата от ИП ${full} по договору`;
      const [coded] = pz.encodeRequest([src]);
      assert.ok(!full.split(" ").some(w => coded.includes(w)), `${full}: nothing of the name is left`);
      assert.equal(pz.stats.persons, 1, `${full}: one person`);
      assert.equal(pz.restore(coded), src, `${full}: exact restore`);
    }
  }

  console.log("✅ pseudonymize: all checks passed (coding rules, restore, streaming, fail-closed, leak scan of the outbound payload, name-service integration)");
}
main().catch(e => { console.error("❌", e.message ?? e); process.exit(1); });
