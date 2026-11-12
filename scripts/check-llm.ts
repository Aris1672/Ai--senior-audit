/**
 * scripts/check-llm.ts — smoke test for the audit LLM (DeepSeek V4 Pro).
 *
 * Runs the REAL system prompt, context builder, record_findings tool and
 * streaming call from lib/llm.ts against a small SYNTHETIC bank statement
 * (every name, ИНН and account below is invented — never put real client
 * data here; see PUNCH_LIST "NEXT SESSION" Step C / 152-FZ).
 *
 * Usage (from the project folder, on a machine that can reach DeepSeek):
 *   1. Put the key in .env.local (git-ignored):   LLM_API_KEY=sk-...
 *      Optional: LLM_THINKING=enabled, LLM_MODEL=..., LLM_BASE_URL=...
 *   2. npm run check:llm
 *
 * Two checks, mirroring the behaviour AUDIT_SYSTEM_PROMPT requires:
 *   A. Audit purpose NOT given → the reply must be only the purpose question,
 *      with no report and no record_findings call.
 *   B. Purpose given → full report, no greeting, record_findings called once
 *      at the end with valid enum values.
 * Exit code 0 = all checks passed, 1 = something failed (details printed).
 */
import fs from "node:fs";
import path from "node:path";

// ── Load .env.local / .env before lib/llm.ts reads process.env ──────────────
for (const file of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SYNTHETIC_STATEMENT = `
=== ДОКУМЕНТ: test_vypiska.csv ===
Файл: test_vypiska.csv
Формат: CSV
Строк данных: 8
Колонки: Дата | Документ | Плательщик | Получатель | ИНН получателя | Счёт получателя | Сумма | Назначение платежа

01.04.2024;п/п 101;ООО "Тест-Альфа";ООО "Вымышленный Поставщик";7700000001;40702810000000000001;150000.00;Оплата по счёту 15 за материалы, в т.ч. НДС 20%
03.04.2024;п/п 102;ООО "Тест-Альфа";ИП Тестов Т.Т.;770000000002;40802810000000000002;500000.00;Оплата за консультационные услуги, без НДС
03.04.2024;п/п 103;ООО "Тест-Альфа";ИП Тестов Т.Т.;770000000002;40802810000000000002;500000.00;Оплата за консультационные услуги, без НДС
05.04.2024;п/п 104;ООО "Тест-Альфа";Примеров П.П.;770000000003;40817810000000000003;300000.00;Под отчёт
10.04.2024;п/п 105;ООО "Тест-Альфа";ООО "Однодневка-Тест";7700000004;40702810000000000004;1000000.00;Оплата по договору 1 за услуги
10.04.2024;п/п 106;ООО "Тест-Альфа";ООО "Однодневка-Тест";7700000004;40702810000000000004;1000000.00;Оплата по договору 1 за услуги
15.04.2024;п/п 107;ООО "Тест-Альфа";УФК по г. Москве (ИФНС);7700000005;03100643000000017300;45000.00;Налог по УСН
23.04.2024;п/п 108;ООО "Тест-Альфа";Примеров П.П.;770000000003;40817810000000000003;250000.00;Возврат займа (договор займа не приложен), время операции 23:40
=== КОНЕЦ: test_vypiska.csv ===`;

type Result = { text: string; toolCalls: { name: string; input: unknown }[]; stopReason: string | null;
  firstTokenMs: number | null; totalMs: number; usage: { input_tokens?: number; output_tokens?: number } };

async function main() {
  if (!process.env.LLM_API_KEY) {
    console.error("LLM_API_KEY is not set (put it in .env.local). Aborting — this test is for the DeepSeek setup.");
    process.exit(1);
  }

  const m = await import("../lib/llm");
  const { llm, AUDIT_MODEL, AUDIT_SYSTEM_PROMPT, buildAuditContext, FINDINGS_TOOL,
          LLM_EXTRA_PARAMS, AUDIT_MAX_OUTPUT_TOKENS, AUDIT_MODEL_PRICING, LLM_PROVIDER } = m;

  console.log(`Provider: ${LLM_PROVIDER} | model: ${AUDIT_MODEL} | extra params: ${JSON.stringify(LLM_EXTRA_PARAMS)}\n`);

  const system = `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext({
    companyName: 'ООО "Тест-Альфа"', periodFrom: "01.04.2024", periodTo: "30.04.2024",
    transactionCount: 8, legalForm: "ООО", taxRegime: "УСН (Доходы − Расходы)", vatStatus: "not_taxed",
    existingFindings: [],
  })}\n\n=== ЗАГРУЖЕННЫЕ ФИНАНСОВЫЕ ДОКУМЕНТЫ ===${SYNTHETIC_STATEMENT}\n=== КОНЕЦ ДОКУМЕНТОВ ===`;

  async function run(messages: { role: "user" | "assistant"; content: string }[]): Promise<Result> {
    const t0 = Date.now();
    let firstTokenMs: number | null = null;
    let text = "";
    const stream = llm.messages.stream({
      model: AUDIT_MODEL, max_tokens: AUDIT_MAX_OUTPUT_TOKENS, system, messages,
      tools: [FINDINGS_TOOL], tool_choice: { type: "auto" }, ...LLM_EXTRA_PARAMS,
    });
    stream.on("text", (d: string) => {
      if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
      text += d;
      process.stdout.write(d);
    });
    const final = await stream.finalMessage();
    process.stdout.write("\n");
    const toolCalls = final.content
      .filter(b => b.type === "tool_use")
      .map(b => ({ name: (b as { name: string }).name, input: (b as { input: unknown }).input }));
    return { text, toolCalls, stopReason: final.stop_reason, firstTokenMs, totalMs: Date.now() - t0, usage: final.usage };
  }

  const failures: string[] = [];
  const check = (ok: boolean, label: string) => { console.log(`  ${ok ? "✅" : "❌"} ${label}`); if (!ok) failures.push(label); };
  const greeting = /^\s*(здравствуйте|добрый день|привет|меня зовут)/i;
  const summary = (r: Result) => {
    const cost = ((r.usage.input_tokens ?? 0) / 1000) * AUDIT_MODEL_PRICING.inputPer1K
               + ((r.usage.output_tokens ?? 0) / 1000) * AUDIT_MODEL_PRICING.outputPer1K;
    console.log(`  stop_reason=${r.stopReason} | first token ${r.firstTokenMs ?? "-"} ms | total ${r.totalMs} ms | ` +
      `tokens in/out ${r.usage.input_tokens}/${r.usage.output_tokens} | ≈ $${cost.toFixed(4)} (peak rate)`);
  };

  // ── A: no audit purpose yet ────────────────────────────────────────────────
  console.log("━━━ A. Purpose not given — expect ONLY the purpose question ━━━");
  const a = await run([{ role: "user", content: "Проверь, пожалуйста, выписку." }]);
  console.log("\nChecks A:");
  summary(a);
  check(a.toolCalls.length === 0, "no record_findings call");
  check(a.text.length < 1500, `short reply (only the question) — ${a.text.length} chars`);
  check(/цел/i.test(a.text), "asks about the audit purpose (цель)");
  check(!greeting.test(a.text), "no greeting / self-introduction");

  // ── B: purpose given → full report + one tool call ─────────────────────────
  console.log("\n━━━ B. Purpose given — expect full report + one record_findings ━━━");
  const b = await run([
    { role: "user", content: "Проверь, пожалуйста, выписку." },
    { role: "assistant", content: a.text || "Уточните, пожалуйста, цель аудита." },
    { role: "user", content: "Цель — подготовка к проверке банка по 115-ФЗ и оценка налоговых рисков." },
  ]);
  console.log("\nChecks B:");
  summary(b);
  check(!greeting.test(b.text), "no greeting / self-introduction");
  check(/резюме/i.test(b.text), "report has the «Резюме аудитора» section");
  const calls = b.toolCalls.filter(c => c.name === "record_findings");
  check(calls.length === 1, `record_findings called exactly once (got ${calls.length})`);
  const findings = (calls[0]?.input as { findings?: Record<string, unknown>[] })?.findings ?? [];
  check(findings.length > 0, `findings recorded: ${findings.length}`);
  const okRisk = new Set(["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"]);
  const okEvidence = new Set(["confirmed", "risk_flag", "indirect"]);
  check(findings.every(f => okRisk.has(String(f.risk_level))), "all risk_level values valid");
  check(findings.every(f => okEvidence.has(String(f.evidence_status))), "all evidence_status values valid");
  for (const f of findings) console.log(`     • [${f.risk_level} / ${f.evidence_status}] ${f.title}`);

  console.log(failures.length ? `\n❌ ${failures.length} check(s) failed.` : "\n✅ All checks passed.");
  process.exit(failures.length ? 1 : 0);
}

main().catch(err => { console.error("\n❌ Request failed:", err?.status ?? "", err?.message ?? err); process.exit(1); });
