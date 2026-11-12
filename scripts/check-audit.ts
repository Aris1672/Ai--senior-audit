/**
 * scripts/check-audit.ts — regression test for audit QUALITY.
 *
 * Runs a full audit (real system prompt, real 1C parser, real record_findings
 * tool, same LLM settings as production) several times on one bank statement
 * whose correct answers are known, and checks each run against them.
 *
 * Fixture: scripts/fixtures/ip-ausn-statement.txt — an ИП on АУСН «Доходы»
 * selling through a marketplace, 71 operations, Nov–Dec 2025. ANONYMISED:
 * the owner's name, ИНН, account and card numbers, the supplier and the
 * contract number are invented; amounts, dates and payment purposes are
 * unchanged. Never replace it with a raw client file (152-FZ).
 *
 * Known facts of the fixture (verified by calculation, Nov 12 2026):
 *   - inflows 54 171,37 / outflows 54 133,04 (match the statement totals)
 *   - invoice № 83973/007 paid twice: п/п 34 (08.12) and п/п 35 (26.12), 2 462,39
 *   - own-card top-ups 31 700 = 58,5% of inflows; marketplace income 20 095,37
 *   - tax reserve is COMPLETE: 1 137,00 on 20.11 to the tax account = 8% of the
 *     14 212,09 November income; every later income has its own 8% transfer;
 *     all 2 376 reserved on top-ups was returned
 *   - supplier = 80,7% of outflows (normal for this business model)
 *
 * Usage (Coolify terminal, or locally with the key in .env.local):
 *   read -s LLM_API_KEY && export LLM_API_KEY && npm run check:audit
 *   RUNS=5 npm run check:audit        # default 3 runs
 * Each run = draft pass + quality-review pass (lib/audit-engine.ts), both with
 * thinking — expect 10–20 minutes per run. Draft and final reports are saved.
 * Full reports are saved to the temp folder printed at the end.
 * Exit code 0 = every required check passed in every run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const FIXTURE = path.join(process.cwd(), "scripts", "fixtures", "ip-ausn-statement.txt");
const RUNS = Math.max(1, parseInt(process.env.RUNS || "3", 10) || 3);

interface Finding { title?: string; risk_level?: string; evidence_status?: string;
  description?: string; legal_basis?: string; recommendation?: string; }
interface RunResult { text: string; findings: Finding[]; reviewed: string; draftFindings: Finding[];
  thinkingChars: number; seconds: number; tokensIn: number; tokensOut: number; }

// Matches a number however the model formats it: "31 700", "31 700,00", "31700.00".
function hasNumber(text: string, intPart: string, frac?: string): boolean {
  const digits = intPart.split("").join("[\\s\\u00a0\\u202f]?");
  const tail = frac ? `[.,]${frac}` : "(?![\\d])";
  return new RegExp(`(?<![\\d])${digits}${tail}`).test(text);
}
const blob = (f: Finding) => `${f.title ?? ""} ${f.description ?? ""} ${f.recommendation ?? ""}`;

// required: true  → a failure fails the test (known right/wrong answers)
// required: false → reported, but only as a warning (style / softer signals)
const CHECKS: { id: string; label: string; required: boolean; test: (r: RunResult) => boolean }[] = [
  { id: "review", required: true, label: "quality review completed (final report is the reviewed one)",
    // when the review is switched off (LLM_REVIEW=disabled) "skipped" is the expected result
    test: r => r.reviewed === (process.env.LLM_REVIEW === "disabled" ? "skipped" : "done") },
  { id: "enums", required: true, label: "all findings have valid risk level and status",
    test: r => r.findings.length > 0 && r.findings.every(f =>
      ["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"].includes(String(f.risk_level)) &&
      ["confirmed", "risk_flag", "indirect"].includes(String(f.evidence_status))) },
  { id: "duplicate", required: true, label: "double payment of invoice 83973/007 recorded",
    test: r => r.findings.some(f => /83973/.test(blob(f))) },
  // Findings are matched by the AMOUNTS / operations they cite, not by title
  // wording — titles vary a lot between runs (first version of these two
  // checks matched on words and gave one false pass and two false fails).
  { id: "topups", required: true, label: "card inflows of unidentified origin (31 700) recorded as a finding",
    test: r => r.findings.some(f => !/факторинг|резервир/i.test(f.title ?? "") && (
      hasNumber(blob(f), "31700") ||
      (/поступлен|пополнен/i.test(f.title ?? "") && /карт|card2card|sbol|p2p/i.test(blob(f))))) },
  // Decision Nov 12, 2026: how the bank marked revenue for АУСН is never a
  // finding at any level — only a «Границы проверки» item.
  { id: "reserve", required: true, label: "November revenue reserve/marking NOT recorded as a finding at any level (limits only)",
    test: r => !r.findings.some(f => /резерв|разметк|размечен/i.test(blob(f)) &&
      (hasNumber(blob(f), "14212", "09") || /13\s?[.–—-]\s?19\.11|ноябрьск|факторинг/i.test(f.title ?? ""))) },
  { id: "marking-limits", required: false, label: "«Границы проверки» tells the client to check the bank's АУСН marking",
    test: r => /разметк/i.test(r.text.slice(Math.max(0, r.text.search(/границы проверки/i)))) },
  // The statement of one account cannot show that tax was not paid: the
  // client reserves tax on another own account. Limits item, not a finding.
  { id: "tax-unpaid", required: true, label: "\"tax not paid\" NOT recorded as a finding (payment may go through the tax-reserve account — limits only)",
    test: r => !r.findings.some(f => /налог\S*[^.]{0,40}не\s?(уплачен|оплачен|перечислен)|неуплат\S+\s+налог|отсутств\S+\s+(уплат|платеж)\S*\s+налог/i.test(f.title ?? "")) },
  { id: "no-docs", required: true, label: "\"no primary documents\" NOT recorded as a violation",
    test: r => !r.findings.some(f => /(отсутств|непредставлен|не представлен)\S*\s+(первичн|подтверждающ)/i.test(f.title ?? "")) },
  { id: "no-402", required: true, label: "402-ФЗ / ПБУ not cited as legal basis against an ИП",
    test: r => !r.findings.some(f => /402|ПБУ/i.test(f.legal_basis ?? "")) },
  { id: "no-critical", required: true, label: "no КРИТИЧНО findings (none exist in this file)",
    test: r => !r.findings.some(f => f.risk_level === "КРИТИЧНО") },
  { id: "totals", required: true, label: "statement totals appear in the report (54 171,37 or 54 133,04)",
    test: r => hasNumber(r.text, "54171", "37") || hasNumber(r.text, "54133", "04") },
  { id: "ledger", required: true, label: "tax-account ledger used: net 1 607,64 or full return of 2 376 stated in the report",
    test: r => hasNumber(r.text, "1607", "64") || hasNumber(r.text, "2376") },
  { id: "restored", required: true, label: "no codes left in the report or findings; the client's name is restored",
    test: r => process.env.LLM_PSEUDONYMIZE === "disabled" ||
      (!/\[(ФЛ|ИНН_ФЛ|СЧ[ЕЁ]Т|КАРТА|ОГРНИП|ТЕЛ|EMAIL)_\d/.test(r.text + JSON.stringify(r.findings)) && /Тестов/.test(r.text)) },
  { id: "sections", required: true, label: "report has «Резюме», «Проверено без замечаний», «Границы проверки»",
    test: r => /резюме/i.test(r.text) && /проверено без замечаний/i.test(r.text) && /границы проверки/i.test(r.text) },
  { id: "reserve-seen", required: false, label: "the 1 137 reserve transfer is mentioned (reconciliation shown)",
    test: r => hasNumber(r.text, "1137") },
  { id: "concentration", required: false, label: "supplier concentration not rated above НЕСУЩЕСТВЕННО",
    test: r => !r.findings.some(f => /концентрац/i.test(f.title ?? "") && f.risk_level !== "НЕСУЩЕСТВЕННО") },
  { id: "personal", required: false, label: "ИП personal spending not rated above НЕСУЩЕСТВЕННО",
    test: r => !r.findings.some(f => /личн\S*\s+(расход|трат|покуп)/i.test(f.title ?? "") && f.risk_level !== "НЕСУЩЕСТВЕННО") },
  { id: "no-injury", required: false, label: "injury-insurance (травматизм) contribution not presented as owed / to be checked for an ИП without employees",
    // A sentence saying it is NOT owed is correct and allowed.
    test: r => !r.text.split(/[\n.;]/).some(line => /травматизм/i.test(line) && !/не (уплачива|плат|возника|начисля|примен)|отсутству/i.test(line)) },
  { id: "tax-date", required: false, label: "АУСН payment deadline not given as the 28th (it is the 25th)",
    test: r => !/28\.(12\.2025|01\.2026)|до 28[\s-]?(го)? (числа|декабря|января)/i.test(r.text) },
  { id: "no-greeting", required: false, label: "no greeting / self-introduction",
    test: r => !/^\s*(здравствуйте|добрый день|привет|меня зовут)/i.test(r.text) },
  { id: "size", required: false, label: "3–7 findings (no padding)",
    test: r => r.findings.length >= 3 && r.findings.length <= 7 },
];

async function main() {
  if (!process.env.LLM_API_KEY) {
    console.error("LLM_API_KEY is not set. Aborting — this test runs against DeepSeek.");
    process.exit(1);
  }
  const { AUDIT_MODEL, AUDIT_SYSTEM_PROMPT, buildAuditContext, LLM_EXTRA_PARAMS,
          AUDIT_MODEL_PRICING, AUDIT_REVIEW_ENABLED, LLM_PSEUDONYMIZE_ENABLED } = await import("../lib/llm");
  const { Pseudonymizer } = await import("../lib/pseudonymize");
  const { runAuditTurn } = await import("../lib/audit-engine");
  const { parseFile } = await import("../lib/file-parser");

  // Same path as /api/chat: real parser → same document block in the system prompt.
  const buf = fs.readFileSync(FIXTURE);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const period = { dateFrom: "2025-11-01", dateTo: "2025-12-31" };
  const parsed = await parseFile(ab, "1c_txt", period);
  const fileName = "vypiska_1c_2025.txt";
  const docBlock =
    `=== ДОКУМЕНТ: ${fileName} ===\nФайл: ${fileName}\nФормат: ${parsed.parseMethod.toUpperCase()}\n` +
    `Строк данных: ${parsed.rowCount}\n\n${parsed.textContent}\n=== КОНЕЦ: ${fileName} ===`;
  const system = `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext({
    companyName: "ИП Тестов Т.Т.", periodFrom: period.dateFrom, periodTo: period.dateTo,
    transactionCount: parsed.rowCount, legalForm: "ИП", taxRegime: "АУСН (Доходы)", vatStatus: "not_taxed",
    existingFindings: [],
  })}\n\n=== ЗАГРУЖЕННЫЕ ФИНАНСОВЫЕ ДОКУМЕНТЫ ===\n${docBlock}\n=== КОНЕЦ ДОКУМЕНТОВ ===`;

  const messages = [
    { role: "user" as const, content: "Проведи аудит загруженной выписки." },
    { role: "assistant" as const, content: "Что является приоритетом при проведении данного аудита: налоговые риски, подготовка к банковской проверке, внутренний контроль или иное?" },
    { role: "user" as const, content: "Налоговые риски и подготовка к банковской проверке." },
  ];

  console.log(`Model: ${AUDIT_MODEL} | params: ${JSON.stringify(LLM_EXTRA_PARAMS)} | review: ${AUDIT_REVIEW_ENABLED ? "on" : "off"} | pseudonymize: ${LLM_PSEUDONYMIZE_ENABLED ? "on" : "off"} | operations: ${parsed.rowCount} | runs: ${RUNS}\n`);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "check-audit-"));
  const passed: Record<string, number> = Object.fromEntries(CHECKS.map(c => [c.id, 0]));
  let completed = 0, totalCost = 0;

  for (let i = 1; i <= RUNS; i++) {
    process.stdout.write(`Run ${i}/${RUNS} `);
    const t0 = Date.now();
    let thinkingChars = 0;
    const dots = setInterval(() => process.stdout.write("."), 10000);
    let r: RunResult;
    try {
      // Same engine as /api/chat: draft pass + quality-review pass.
      const res = await runAuditTurn(system, messages, {
        step: () => {}, text: () => {}, reset: () => {},
        thinking: (d: string) => { thinkingChars += d.length; },
      }, LLM_PSEUDONYMIZE_ENABLED ? new Pseudonymizer() : undefined);
      r = { text: res.text, findings: res.findings as Finding[], reviewed: res.reviewed,
            draftFindings: (res.draft?.findings ?? []) as Finding[], thinkingChars,
            seconds: Math.round((Date.now() - t0) / 1000), tokensIn: res.tokensIn, tokensOut: res.tokensOut };
      if (res.draft) fs.writeFileSync(path.join(outDir, `run-${i}-draft.md`),
        `${res.draft.text}\n\n---\nrecord_findings (draft):\n${JSON.stringify(res.draft.findings, null, 2)}\n`);
    } catch (err) {
      clearInterval(dots);
      const e = err as { status?: number; message?: string };
      console.log(`\n  ❌ request failed: ${e?.status ?? ""} ${e?.message ?? err}`);
      continue;
    }
    clearInterval(dots);
    completed++;
    const cost = (r.tokensIn / 1000) * AUDIT_MODEL_PRICING.inputPer1K + (r.tokensOut / 1000) * AUDIT_MODEL_PRICING.outputPer1K;
    totalCost += cost;
    console.log(` ${r.seconds}s | thinking ${r.thinkingChars} chars | tokens ${r.tokensIn}/${r.tokensOut} | ≈$${cost.toFixed(3)} | review: ${r.reviewed} | findings: draft ${r.draftFindings.length} → final ${r.findings.length}`);
    const finalTitles = new Set(r.findings.map(f => f.title));
    for (const f of r.draftFindings) if (!finalTitles.has(f.title)) console.log(`     (draft only) [${f.risk_level} / ${f.evidence_status}] ${f.title}`);
    for (const f of r.findings) console.log(`     • [${f.risk_level} / ${f.evidence_status}] ${f.title}`);
    for (const c of CHECKS) {
      const ok = c.test(r);
      if (ok) passed[c.id]++;
      else console.log(`     ${c.required ? "❌" : "⚠️ "} ${c.label}`);
    }
    fs.writeFileSync(path.join(outDir, `run-${i}.md`),
      `${r.text}\n\n---\nrecord_findings:\n${JSON.stringify(r.findings, null, 2)}\n`);
  }

  console.log(`\n━━━ Summary: ${completed}/${RUNS} runs completed, ≈$${totalCost.toFixed(2)} at peak rate ━━━`);
  let failed = completed < RUNS;
  for (const c of CHECKS) {
    const n = passed[c.id];
    const ok = n === RUNS;
    if (!ok && c.required) failed = true;
    console.log(`  ${ok ? "✅" : c.required ? "❌" : "⚠️ "} ${n}/${RUNS}  ${c.label}${c.required ? "" : "  (warning only)"}`);
  }
  console.log(`\nFull reports: ${outDir}`);
  console.log(failed ? "❌ FAILED — at least one required check did not pass in every run."
                     : "✅ PASSED — all required checks passed in every run.");
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error("\n❌ Failed:", err?.message ?? err); process.exit(1); });
