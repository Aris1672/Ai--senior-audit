/**
 * lib/finding-updates.ts — stage 2: closing findings with supporting documents.
 * Pure part: what the agent is shown, the tool it uses, and validation of
 * what it sends back.
 *
 * Decision of Nov 13, 2026: THE AGENT PROPOSES, THE CLIENT CONFIRMS. The
 * agent can never close a finding itself — `update_findings` only records a
 * proposal (or a note on what is still missing). A finding becomes "resolved"
 * only when the client confirms the proposal (/api/findings/decide).
 *
 * The rules live in the block that is added to the request only when the
 * audit already has findings — the main prompt is unchanged, so a first
 * analysis runs exactly as before.
 */
import type Anthropic from "@anthropic-ai/sdk";

export interface AgentFinding {
  id: string;
  code: string;                 // "Н-1", "Н-2" … stable within an audit (order of creation)
  title: string;
  description: string;
  recommendation: string | null;
  risk_level: string;
  evidence_status: string | null;
  status: string;               // open | resolved | disputed
  proposed: boolean;            // a closing proposal is waiting for the client
  agent_note: string | null;    // what the agent last said is still missing
  /** The client declined the agent's last proposal to close (and nothing was proposed since). */
  declined?: { at: string; basis: string } | null;
}

export const findingCode = (index: number) => `Н-${index + 1}`;

export const UPDATE_FINDINGS_TOOL: Anthropic.Messages.Tool = {
  name: "update_findings",
  description:
    "Этап 2. Сообщает результат сопоставления новых документов или пояснений клиента с УЖЕ записанными выводами аудита (коды Н-1, Н-2 … из блока «Открытые выводы»). " +
    "Не создаёт новых выводов и не закрывает их: предложение о закрытии вступает в силу только после подтверждения клиентом. " +
    "Вызывается один раз в конце ответа и только если новые документы или пояснения относятся хотя бы к одному открытому выводу.",
  input_schema: {
    type: "object" as const,
    properties: {
      updates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            finding: { type: "string", description: "Код вывода из блока «Открытые выводы», например «Н-3»." },
            action: {
              type: "string", enum: ["propose_close", "keep_open"],
              description: "propose_close — документы полностью устраняют основание вывода; keep_open — вывод остаётся открытым (документы не относятся, покрывают его частично или вызывают вопросы).",
            },
            basis: { type: "string", description: "Что именно в документах подтверждает решение: реквизиты документа, суммы, даты, пункты. 1–3 предложения." },
            documents: { type: "array", items: { type: "string" }, description: "Имена файлов, на которых основано решение." },
            remaining: { type: "string", description: "Для keep_open: что ещё нужно представить, чтобы вывод можно было закрыть (конкретные документы, суммы, периоды). Для propose_close — пустая строка." },
          },
          required: ["finding", "action", "basis"],
        },
      },
    },
    required: ["updates"],
  },
};

const RISK_LABEL: Record<string, string> = { critical: "КРИТИЧНО", material: "СУЩЕСТВЕННО", major: "СУЩЕСТВЕННО", minor: "НЕСУЩЕСТВЕННО" };
const STATUS_LABEL: Record<string, string> = { confirmed: "Подтверждённое нарушение", risk_flag: "Признак риска", indirect: "Косвенный признак" };
const clip = (s: string | null | undefined, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** The block added to the request when the audit already has findings. Empty string when it has none. */
export function buildFindingsBlock(findings: AgentFinding[]): string {
  if (findings.length === 0) return "";
  const open = findings.filter(f => f.status === "open");
  const closed = findings.filter(f => f.status !== "open");

  const lines: string[] = [];
  lines.push("━━━ ВЫВОДЫ, УЖЕ ЗАПИСАННЫЕ ПО ЭТОМУ АУДИТУ (ЭТАП 2: РАБОТА С ПОДТВЕРЖДАЮЩИМИ ДОКУМЕНТАМИ) ━━━");
  lines.push("Эти выводы уже есть в реестре клиента. Повторно их не записывай.");
  lines.push("", `ОТКРЫТЫЕ ВЫВОДЫ (${open.length}):`);
  for (const f of open) {
    lines.push(`[${f.code}] ${RISK_LABEL[f.risk_level] ?? f.risk_level} · ${STATUS_LABEL[f.evidence_status ?? ""] ?? "статус не указан"} · ${clip(f.title, 200)}`);
    lines.push(`  Суть: ${clip(f.description, 700)}`);
    if (f.recommendation) lines.push(`  Рекомендация: ${clip(f.recommendation, 300)}`);
    if (f.proposed) lines.push("  Состояние: закрытие уже предложено, ожидает решения клиента — повторно не предлагай, если нет новых документов.");
    else if (f.declined) lines.push(`  Состояние: клиент ОТКЛОНИЛ твоё предложение закрыть этот вывод (${f.declined.at}). Основание того предложения: ${clip(f.declined.basis, 300)} Сам повторно не предлагай; пересматривай только по прямой просьбе клиента или при новых документах (правило 8).`);
    else if (f.agent_note) lines.push(`  Ранее ты указал, чего не хватает: ${clip(f.agent_note, 300)}`);
  }
  if (open.length === 0) lines.push("(открытых выводов нет)");
  if (closed.length > 0) {
    lines.push("", `ЗАКРЫТЫЕ ВЫВОДЫ (${closed.length}) — для сведения, не открывай их заново без новых данных:`);
    for (const f of closed) lines.push(`[${f.code}] ${clip(f.title, 160)}`);
  }

  lines.push("", `ПРАВИЛА ЭТАПА 2
1. Кто закрывает вывод. Ты только ПРЕДЛАГАЕШЬ закрытие через update_findings (action "propose_close"). Решение принимает клиент. Не пиши, что вывод «закрыт» или «снят», — пиши «предлагаю закрыть».
2. Когда вызывать update_findings. Если в этом сообщении клиент загрузил новые документы или дал пояснения, сопоставь их с каждым открытым выводом и вызови update_findings один раз — по каждому выводу, которого документы касаются. Вывод, к которому документы не относятся, не упоминай. Если новых документов и пояснений по выводам нет (обычный вопрос) — update_findings не вызывай.
3. Когда можно предлагать закрытие. Только если документы ПРЯМО устраняют основание вывода и покрывают его ПОЛНОСТЬЮ — контрагент, сумма и период совпадают с данными вывода:
   • «Оплата / расход без документов»: договор И закрывающие документы (акты, УПД, накладные) на всю сумму и весь период. Только договор, только счёт или только счёт-фактура — недостаточно. Документы покрывают часть суммы — keep_open, в remaining назови непокрытую сумму и период.
   • «Повторная оплата / переплата»: возврат денег, виден в выписке; либо акт сверки с отражённым зачётом; либо документ второй поставки на эту сумму. Счёт или счёт-фактура на первую поставку основанием не являются.
   • «Налог или взнос не удержан / не уплачен»: платёжный документ, справка о сальдо ЕНС, принятый уточнённый расчёт. Намерение уплатить основанием не является.
   • «Поступления неустановленного происхождения»: документ об источнике по каждой сумме.
   • «Статус исполнителя-физлица»: справка о постановке на учёт как плательщика НПД и чеки на суммы выплат, либо выписка ЕГРИП; иначе — документы об удержании НДФЛ и начислении взносов.
   • Ошибка в учёте (непроведённый документ, неверная проводка, не начислен налог): обновлённые данные учёта, в которых ошибка исправлена (новый снимок базы, выписка). Слова «исправили» без данных — недостаточно.
   • Косвенный признак / наблюдение: документальное объяснение, которое его снимает.
4. Когда закрытие предлагать нельзя — всегда keep_open: основание — только слова клиента без документа; документ не прочитан (изображение или скан без распознанного текста); документ относится к другому контрагенту, периоду или сумме; документ сам вызывает вопросы (не сходятся реквизиты, даты, суммы; дата документа позже событий без объяснения) — тогда опиши несоответствие. При сомнении — keep_open.
5. Документ может изменить оценку, не закрывая вывод (сумма под риском стала меньше, появилась новая деталь) — keep_open, изменение опиши в basis.
6. Новые выводы. Если документы выявили то, чего нет в списке выше, — запиши это через record_findings (только новое). Существующие выводы через record_findings не повторяй.
7. Формат ответа на этом этапе — краткий, НЕ восемь разделов отчёта:
   **Что проверено** — какие документы и с чем сопоставлены (1–3 строки).
   **По открытым выводам** — по каждому затронутому выводу: код и название, «предлагаю закрыть» или «остаётся открытым», основание, что ещё нужно.
   **Новые выводы** — только если есть.
   **Что запросить дальше** — конкретные документы по оставшимся открытым выводам.
   Полный отчёт из восьми разделов составляй заново, только если клиент прямо просит об этом или загрузил новые первичные данные (выписку, выгрузку, базу) с новыми операциями — тогда проанализируй их как обычно, а существующие выводы не дублируй.
8. Пересмотр по просьбе клиента. Если клиент прямо просит пересмотреть конкретный вывод (называет его код или суть) — заново сопоставь этот вывод со ВСЕМИ документами аудита, включая загруженные ранее, по правилам 3–5, и вызови update_findings по нему: "propose_close", если основание устранено полностью, иначе "keep_open" с тем, чего не хватает. Это относится и к выводу, по которому клиент ранее отклонил твоё предложение: просьба пересмотреть — достаточный повод оценить его заново, но не повод ослабить требования к документам. Если клиент возражает по существу (считает документ недостаточным) — объясни свою оценку и, если он прав, оставь вывод открытым.`);
  return lines.join("\n");
}

export interface ValidUpdate {
  findingId: string;
  code: string;
  action: "propose_close" | "keep_open";
  basis: string;
  documents: string[];
  remaining: string;
}

/**
 * Checks what the agent sent. An entry is dropped when it names a code that
 * is not an OPEN finding of this audit, has no basis, or repeats a code.
 */
export function validateUpdates(raw: unknown[], findings: AgentFinding[]): { valid: ValidUpdate[]; skipped: string[] } {
  const byCode = new Map(findings.map(f => [f.code.toUpperCase().replace(/\s+/g, ""), f]));
  const valid: ValidUpdate[] = [], skipped: string[] = [], seen = new Set<string>();
  for (const item of raw) {
    const u = (item ?? {}) as Record<string, unknown>;
    const code = String(u.finding ?? "").toUpperCase().replace(/[\s\[\]]/g, "").replace(/^H-/, "Н-");   // Latin H → Cyrillic Н
    const f = byCode.get(code);
    const action = u.action === "propose_close" || u.action === "keep_open" ? u.action : null;
    const basis = String(u.basis ?? "").trim();
    if (!f)                    { skipped.push(`${code || "?"}: нет такого вывода`); continue; }
    if (f.status !== "open")   { skipped.push(`${f.code}: вывод уже закрыт`); continue; }
    if (!action)               { skipped.push(`${f.code}: не указано действие`); continue; }
    if (basis.length < 10)     { skipped.push(`${f.code}: не указано основание`); continue; }
    if (seen.has(f.id))        { skipped.push(`${f.code}: повтор`); continue; }
    seen.add(f.id);
    valid.push({
      findingId: f.id, code: f.code, action, basis: basis.slice(0, 2000),
      documents: Array.isArray(u.documents) ? u.documents.map(d => String(d).trim()).filter(Boolean).slice(0, 20) : [],
      remaining: action === "keep_open" ? String(u.remaining ?? "").trim().slice(0, 2000) : "",
    });
  }
  return { valid, skipped };
}
