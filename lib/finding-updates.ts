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
 * Correcting an assessment (Nov 13, 2026, migration 007): the agent may also
 * PROPOSE a corrected version of an open finding (`propose_revise` — risk
 * level, evidence status, title, description, legal basis, recommendation).
 * It changes nothing until the client confirms it.
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
  legal_basis?: string | null;
  risk_level: string;
  evidence_status: string | null;
  status: string;               // open | resolved | disputed
  proposed: boolean;            // a closing proposal is waiting for the client
  revisionProposed?: boolean;   // a corrected assessment is waiting for the client
  agent_note: string | null;    // what the agent last said is still missing
  /** The client declined the agent's last proposal to close (and nothing was proposed since). */
  declined?: { at: string; basis: string } | null;
}

export const findingCode = (index: number) => `Н-${index + 1}`;

const REVISION_FIELDS = {
  risk_level:      { type: "string", enum: ["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"], description: "Новый уровень существенности." },
  evidence_status: { type: "string", enum: ["confirmed", "risk_flag", "indirect"], description: "Новый статус достоверности: confirmed — подтверждённое нарушение, risk_flag — признак риска, indirect — косвенный признак." },
  title:           { type: "string", description: "Новое название вывода (до 100 знаков) — только если прежнее неверно." },
  description:     { type: "string", description: "Новое описание целиком (до 500 знаков)." },
  legal_basis:     { type: "string", description: "Новое правовое основание целиком (до 200 знаков)." },
  recommendation:  { type: "string", description: "Новая рекомендация целиком (до 300 знаков)." },
} as const;

/**
 * The stage-2 tool. `withRevise` (migration 007 run) adds the third action,
 * proposing a corrected assessment.
 */
export function updateFindingsTool(withRevise: boolean): Anthropic.Messages.Tool {
  return {
    name: "update_findings",
    description:
      "Этап 2. Сообщает результат сопоставления новых документов или пояснений клиента с УЖЕ записанными выводами аудита (коды Н-1, Н-2 … из блока «Открытые выводы»). " +
      "Не создаёт новых выводов и не закрывает их: предложение о закрытии" + (withRevise ? " или об исправлении оценки" : "") + " вступает в силу только после подтверждения клиентом. " +
      "Вызывается один раз в конце ответа в двух случаях: (1) новые документы или пояснения клиента относятся хотя бы к одному открытому выводу; (2) клиент просит пересмотреть вывод — тогда вызов ОБЯЗАТЕЛЕН по этому выводу, даже если новых документов нет. " +
      "Слова «предлагаю закрыть»" + (withRevise ? " или «предлагаю исправить оценку»" : "") + " в тексте ответа без вызова этого инструмента ничего не меняют: клиент не получит предложения.",
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
                type: "string", enum: withRevise ? ["propose_close", "keep_open", "propose_revise"] : ["propose_close", "keep_open"],
                description: "propose_close — документы полностью устраняют основание вывода; keep_open — вывод остаётся открытым (документы не относятся, покрывают его частично или вызывают вопросы)" +
                  (withRevise ? "; propose_revise — оценка вывода записана неверно (уровень, статус достоверности, правовое обоснование, описание): предложить исправленную версию, поля — в revision" : "") + ".",
              },
              basis: { type: "string", description: "Что именно в документах подтверждает решение: реквизиты документа, суммы, даты, пункты. 1–3 предложения." + (withRevise ? " Для propose_revise — почему прежняя оценка неверна (норма, правило)." : "") },
              documents: { type: "array", items: { type: "string" }, description: "Имена файлов, на которых основано решение." },
              remaining: { type: "string", description: "Для keep_open: что ещё нужно представить, чтобы вывод можно было закрыть (конкретные документы, суммы, периоды). Для propose_close — пустая строка." },
              ...(withRevise ? {
                revision: {
                  type: "object",
                  description: "Только для propose_revise: ТОЛЬКО изменяемые поля, каждое — новым текстом целиком. Неизменяемые поля не указывай.",
                  properties: REVISION_FIELDS,
                },
              } : {}),
            },
            required: ["finding", "action", "basis"],
          },
        },
      },
      required: ["updates"],
    },
  };
}

/** The tool without the correction action (before migration 007). */
export const UPDATE_FINDINGS_TOOL: Anthropic.Messages.Tool = updateFindingsTool(false);

const RISK_LABEL: Record<string, string> = { critical: "КРИТИЧНО", material: "СУЩЕСТВЕННО", major: "СУЩЕСТВЕННО", minor: "НЕСУЩЕСТВЕННО" };
const STATUS_LABEL: Record<string, string> = { confirmed: "Подтверждённое нарушение", risk_flag: "Признак риска", indirect: "Косвенный признак" };
const clip = (s: string | null | undefined, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** The block added to the request when the audit already has findings. Empty string when it has none. */
export function buildFindingsBlock(findings: AgentFinding[], withRevise = false): string {
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
    if (f.legal_basis) lines.push(`  Основание (норма): ${clip(f.legal_basis, 250)}`);
    if (f.recommendation) lines.push(`  Рекомендация: ${clip(f.recommendation, 300)}`);
    if (f.revisionProposed) lines.push("  Состояние: исправление оценки уже предложено, ожидает решения клиента — повторно не предлагай.");
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
2. Когда вызывать update_findings. Если в этом сообщении клиент загрузил новые документы или дал пояснения, сопоставь их с каждым открытым выводом и вызови update_findings один раз — по каждому выводу, которого документы касаются. Вывод, к которому документы не относятся, не упоминай. Если новых документов и пояснений по выводам нет и клиент не просит пересмотреть вывод (обычный вопрос) — update_findings не вызывай. Каждое «предлагаю закрыть» и «остаётся открытым» в тексте ответа должно сопровождаться записью в update_findings: без вызова инструмента клиент не увидит предложения и не сможет принять решение.
3. Когда можно предлагать закрытие. Только если документы ПРЯМО устраняют основание вывода и покрывают его ПОЛНОСТЬЮ — контрагент, сумма и период совпадают с данными вывода:
   • «Оплата / расход без документов»: договор И закрывающие документы (акты, УПД, накладные) на всю сумму и весь период. Только договор, только счёт или только счёт-фактура — недостаточно. Документы покрывают часть суммы — keep_open, в remaining назови непокрытую сумму и период.
   • «Повторная оплата / переплата»: возврат денег, виден в выписке; либо акт сверки с отражённым зачётом; либо документ второй поставки на эту сумму. Счёт или счёт-фактура на первую поставку основанием не являются.
   • «Налог или взнос не удержан / не уплачен»: платёжный документ, справка о сальдо ЕНС, принятый уточнённый расчёт. Намерение уплатить основанием не является.
   • «Поступления неустановленного происхождения»: документ об источнике по каждой сумме.
   • «Статус исполнителя-физлица»: справка о постановке на учёт как плательщика НПД и чеки на суммы выплат, либо выписка ЕГРИП; иначе — документы об удержании НДФЛ и начислении взносов.
   • Ошибка в учёте (непроведённый документ, неверная проводка, не начислен налог): обновлённые данные учёта, в которых ошибка исправлена (новый снимок базы, выписка). Слова «исправили» без данных — недостаточно.
   • Косвенный признак / наблюдение: документальное объяснение, которое его снимает.
4. Когда закрытие предлагать нельзя — всегда keep_open: основание — только слова клиента без документа; документ не прочитан (изображение или скан без распознанного текста, страница скана не распознана надёжно); сумма, дата или номер взяты из скана (OCR) и не совпадают с цифрой, уже имеющейся в базе 1С или в выписке, либо помечены [?]; документ относится к другому контрагенту, периоду или сумме; документ сам вызывает вопросы (не сходятся реквизиты, даты, суммы; дата документа позже событий без объяснения) — тогда опиши несоответствие. При сомнении — keep_open.
5. Документ может изменить оценку, не закрывая вывод (сумма под риском стала меньше, появилась новая деталь) — keep_open, изменение опиши в basis.
6. Новые выводы. Если документы выявили то, чего нет в списке выше, — запиши это через record_findings (только новое). Существующие выводы через record_findings не повторяй.
7. Формат ответа на этом этапе — краткий, НЕ восемь разделов отчёта:
   **Что проверено** — какие документы и с чем сопоставлены (1–3 строки).
   **По открытым выводам** — по каждому затронутому выводу: код и название, «предлагаю закрыть» или «остаётся открытым», основание, что ещё нужно.
   **Новые выводы** — только если есть.
   **Что запросить дальше** — конкретные документы по оставшимся открытым выводам.
   Полный отчёт из восьми разделов составляй заново, только если клиент прямо просит об этом или загрузил новые первичные данные (выписку, выгрузку, базу) с новыми операциями — тогда проанализируй их как обычно, а существующие выводы не дублируй.
8. Пересмотр по просьбе клиента. Если клиент прямо просит пересмотреть конкретный вывод (называет его код или суть) — заново сопоставь этот вывод со ВСЕМИ документами аудита, включая загруженные ранее, по правилам 3–5, и ОБЯЗАТЕЛЬНО вызови update_findings по нему (это исключение из правила 2 — новых документов для этого не нужно): "propose_close", если основание устранено полностью, иначе "keep_open" с тем, чего не хватает. Это относится и к выводу, по которому клиент ранее отклонил твоё предложение: просьба пересмотреть — достаточный повод оценить его заново, но не повод ослабить требования к документам. Если клиент возражает по существу (считает документ недостаточным) — объясни свою оценку и, если он прав, оставь вывод открытым.`);
  if (withRevise) lines.push(`9. Исправление оценки. Если при пересмотре вывода или по новым документам ты видишь, что открытый вывод записан НЕВЕРНО по существу — неверен уровень существенности или статус достоверности, неверно правовое обоснование, описание противоречит данным или правилам основного промпта (например, нижней границе уровня для обязанностей налогового агента), — предложи исправленную версию: update_findings с action "propose_revise", в revision — только изменяемые поля, каждое новым текстом целиком; в basis — почему прежняя оценка неверна (норма, правило, документ). Исправление вступает в силу только после подтверждения клиентом. В тексте ответа пиши «предлагаю исправить оценку» и перечисли, что меняется. Не используй это для мелкой правки формулировок, для закрытия вывода или для новых нарушений (новое — через record_findings). По одному выводу в одном вызове — одно действие: если вывод одновременно и закрывается документами, предлагай закрытие; если при пересмотре по просьбе клиента (правило 8) вывод остаётся открытым, но его оценка неверна, — propose_revise вместо keep_open.`);
  return lines.join("\n");
}

/**
 * Safety net. The agent sometimes writes "Н-7 … — предлагаю закрыть" in its
 * answer and does not call update_findings; the client would then see the
 * words and no card to decide on. When a turn brought no tool entries, the
 * closing proposals are read from the text: the code, and as the basis the
 * text that follows up to the next finding, heading or blank line. They go
 * through the same validation, and nothing closes without the client.
 */
export function proposalsFromText(text: string): { finding: string; action: "propose_close"; basis: string; documents: string[] }[] {
  const out: { finding: string; action: "propose_close"; basis: string; documents: string[] }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/([НH]-\d+)\b[^\n]*?[—–-]\s*\**\s*предлагаю закрыть\**[.:]?\s*(.*)$/i);
    if (!m) continue;
    const parts = [m[2]];
    for (let j = i + 1; j < lines.length && parts.join(" ").length < 800; j++) {
      const l = lines[j].trim();
      if (!l || /[НH]-\d+\b.*[—–-]\s*\**\s*(предлагаю закрыть|оста[её]тся открытым)/i.test(l) || /^(\*\*|#+\s*)?(Новые выводы|Что запросить дальше|Что проверено|По открытым выводам)/i.test(l)) break;
      parts.push(l.replace(/^[-•*]\s*/, ""));
    }
    const basis = parts.join(" ").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    const documents = [...new Set(basis.match(/[\w\-.]+\.(?:pdf|docx?|xlsx?|csv|txt|png|jpe?g)\b/gi) ?? [])];
    out.push({ finding: m[1], action: "propose_close", basis, documents });
  }
  return out;
}

export interface Revision {
  risk_level?: string;
  evidence_status?: string;
  title?: string;
  description?: string;
  legal_basis?: string;
  recommendation?: string;
}

export interface ValidUpdate {
  findingId: string;
  code: string;
  action: "propose_close" | "keep_open" | "propose_revise";
  basis: string;
  documents: string[];
  remaining: string;
  /** propose_revise only: the fields that change (already checked and trimmed). */
  revision?: Revision;
}

const RISK_IN: Record<string, string> = {
  "КРИТИЧНО": "КРИТИЧНО", "СУЩЕСТВЕННО": "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО": "НЕСУЩЕСТВЕННО",
  critical: "КРИТИЧНО", material: "СУЩЕСТВЕННО", major: "СУЩЕСТВЕННО", minor: "НЕСУЩЕСТВЕННО",
};
const EVIDENCE_IN: Record<string, string> = {
  confirmed: "confirmed", risk_flag: "risk_flag", indirect: "indirect",
  "подтверждённое нарушение": "confirmed", "подтвержденное нарушение": "confirmed", "признак риска": "risk_flag", "косвенный признак": "indirect",
};
/** Same limits as findings recorded by record_findings (app/api/chat/route.ts). */
const TEXT_LIMITS = { title: 100, description: 500, legal_basis: 200, recommendation: 300 } as const;

/**
 * The fields of a proposed correction that really change something. Unknown
 * values are dropped; texts are trimmed to the same limits as new findings.
 */
export function cleanRevision(raw: unknown, f: AgentFinding): Revision {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Revision = {};
  const risk = RISK_IN[String(r.risk_level ?? "").trim()] ?? RISK_IN[String(r.risk_level ?? "").trim().toLowerCase()];
  if (risk && risk !== (RISK_IN[f.risk_level] ?? f.risk_level)) out.risk_level = risk;
  const ev = EVIDENCE_IN[String(r.evidence_status ?? "").trim().toLowerCase()];
  if (ev && ev !== f.evidence_status) out.evidence_status = ev;
  const current: Record<string, string> = {
    title: f.title ?? "", description: f.description ?? "", legal_basis: f.legal_basis ?? "", recommendation: f.recommendation ?? "",
  };
  for (const key of Object.keys(TEXT_LIMITS) as (keyof typeof TEXT_LIMITS)[]) {
    const v = typeof r[key] === "string" ? (r[key] as string).replace(/\s+/g, " ").trim().slice(0, TEXT_LIMITS[key]) : "";
    if (v.length >= 5 && v !== current[key].trim()) out[key] = v;
  }
  return out;
}

const EVIDENCE_NAME: Record<string, string> = { confirmed: "Подтверждённое нарушение", risk_flag: "Признак риска", indirect: "Косвенный признак" };
const FIELD_NAME: Record<string, string> = { title: "название", description: "описание", legal_basis: "правовое основание", recommendation: "рекомендация" };

/** One line for the client: "Уровень: НЕСУЩЕСТВЕННО → СУЩЕСТВЕННО; статус: … → …; изменены: описание, правовое основание". */
export function describeRevision(before: { risk_level?: string | null; evidence_status?: string | null }, rev: Revision): string {
  const parts: string[] = [];
  if (rev.risk_level) parts.push(`уровень: ${before.risk_level ?? "—"} → ${rev.risk_level}`);
  if (rev.evidence_status) parts.push(`статус: ${EVIDENCE_NAME[before.evidence_status ?? ""] ?? "—"} → ${EVIDENCE_NAME[rev.evidence_status]}`);
  const texts = (Object.keys(FIELD_NAME) as (keyof Revision)[]).filter(k => rev[k]).map(k => FIELD_NAME[k]);
  if (texts.length) parts.push(`изменены: ${texts.join(", ")}`);
  const line = parts.join("; ");
  return line ? line[0].toUpperCase() + line.slice(1) : "";
}

/**
 * Checks what the agent sent. An entry is dropped when it names a code that
 * is not an OPEN finding of this audit, has no basis, or repeats a code.
 */
export function validateUpdates(raw: unknown[], findings: AgentFinding[], withRevise = false): { valid: ValidUpdate[]; skipped: string[] } {
  const byCode = new Map(findings.map(f => [f.code.toUpperCase().replace(/\s+/g, ""), f]));
  const valid: ValidUpdate[] = [], skipped: string[] = [], seen = new Set<string>();
  for (const item of raw) {
    const u = (item ?? {}) as Record<string, unknown>;
    const code = String(u.finding ?? "").toUpperCase().replace(/[\s\[\]]/g, "").replace(/^H-/, "Н-");   // Latin H → Cyrillic Н
    const f = byCode.get(code);
    const action = u.action === "propose_close" || u.action === "keep_open" || (u.action === "propose_revise" && withRevise) ? u.action : null;
    const basis = String(u.basis ?? "").trim();
    if (!f)                    { skipped.push(`${code || "?"}: нет такого вывода`); continue; }
    if (f.status !== "open")   { skipped.push(`${f.code}: вывод уже закрыт`); continue; }
    if (!action)               { skipped.push(`${f.code}: не указано действие`); continue; }
    if (basis.length < 10)     { skipped.push(`${f.code}: не указано основание`); continue; }
    if (seen.has(f.id))        { skipped.push(`${f.code}: повтор`); continue; }
    let revision: Revision | undefined;
    if (action === "propose_revise") {
      if (f.revisionProposed)  { skipped.push(`${f.code}: исправление уже ожидает решения клиента`); continue; }
      revision = cleanRevision(u.revision, f);
      if (Object.keys(revision).length === 0) { skipped.push(`${f.code}: в исправлении нет изменений`); continue; }
    }
    seen.add(f.id);
    valid.push({
      findingId: f.id, code: f.code, action, basis: basis.slice(0, 2000),
      documents: Array.isArray(u.documents) ? u.documents.map(d => String(d).trim()).filter(Boolean).slice(0, 20) : [],
      remaining: action === "keep_open" ? String(u.remaining ?? "").trim().slice(0, 2000) : "",
      ...(revision ? { revision } : {}),
    });
  }
  return { valid, skipped };
}
