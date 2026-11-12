import Anthropic from "@anthropic-ai/sdk";
import { VAT_STATUS_LABELS } from "./audit-constants";

// ─── LLM client (server-side only) ────────────────────────────────────────────
// November 2026: the audit model moves from Anthropic (Claude Sonnet 5) to
// DeepSeek V4 Pro, because Anthropic is banned in Russia. DeepSeek offers an
// Anthropic-compatible Messages endpoint, so the same @anthropic-ai/sdk client,
// streaming, NDJSON heartbeat and record_findings tool all keep working —
// only the base URL, key and model id change.
//
// Which provider is used is decided by the environment, so the cut-over (and
// a rollback) is a Coolify env change, not a code change:
//
//   LLM_API_KEY set     → DeepSeek
//     LLM_BASE_URL       default https://api.deepseek.com/anthropic
//     LLM_MODEL          default deepseek-v4-pro
//     LLM_THINKING       "enabled" | "disabled" (default enabled, see below)
//     LLM_EFFORT         "low" | "high" | "max" (default max)
//
//   LLM_API_KEY not set → legacy Anthropic setup, unchanged
//     ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL (Kazakhstan proxy), claude-sonnet-5
//
// ⚠️ 152-FZ: until the pseudonymizer is built (PUNCH_LIST "NEXT SESSION" →
// Step C), only synthetic/fake data may be sent to DeepSeek.
export type LlmProvider = "deepseek" | "anthropic";

export const LLM_PROVIDER: LlmProvider = process.env.LLM_API_KEY ? "deepseek" : "anthropic";

const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic";
const DEEPSEEK_DEFAULT_MODEL    = "deepseek-v4-pro";
const ANTHROPIC_LEGACY_MODEL    = "claude-sonnet-5";

export const llm = LLM_PROVIDER === "deepseek"
  ? new Anthropic({
      apiKey:  process.env.LLM_API_KEY!,
      baseURL: process.env.LLM_BASE_URL || DEEPSEEK_DEFAULT_BASE_URL,
    })
  : new Anthropic({
      apiKey:  process.env.ANTHROPIC_API_KEY!,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    });

// Main audit reasoning + findings extraction (single call with record_findings).
export const AUDIT_MODEL = LLM_PROVIDER === "deepseek"
  ? (process.env.LLM_MODEL || DEEPSEEK_DEFAULT_MODEL)
  : ANTHROPIC_LEGACY_MODEL;

// deepseek-v4-pro has no image input: per DeepSeek's Anthropic-API docs it
// replaces images with "[Unsupported Image]" — but the image bytes would
// still be uploaded to DeepSeek. So images and scanned PDFs are never sent
// to DeepSeek at all; they wait for the server-side OCR service (Step B).
export const LLM_SUPPORTS_IMAGES = LLM_PROVIDER === "anthropic";

// Thinking mode + effort — ON at MAXIMUM by default (decided Nov 12, 2026:
// audit quality comes first). DeepSeek's thinking-mode guide: effort is set
// via output_config.effort ("low" | "high" | "max"); for deepseek-v4-pro,
// "max" maps to max. budget_tokens is ignored by DeepSeek (the SDK type just
// requires it). Thinking tokens are billed as output and count against
// max_tokens, hence the larger cap below.
//   LLM_THINKING=disabled → turn thinking off (faster/cheaper, weaker)
//   LLM_EFFORT=high       → lower effort (default max)
// Thinking-mode rules that the chat route follows: tool_choice must stay
// "auto" (type:"tool" returns 400), and when continuing a cut-off answer the
// assistant's full content incl. thinking blocks must be passed back.
export const LLM_THINKING_ENABLED =
  LLM_PROVIDER === "deepseek" && process.env.LLM_THINKING !== "disabled";

const effortEnv = process.env.LLM_EFFORT;
export const LLM_EFFORT: "low" | "high" | "max" =
  effortEnv === "low" || effortEnv === "high" ? effortEnv : "max";

export const LLM_EXTRA_PARAMS: {
  thinking?: Anthropic.Messages.ThinkingConfigParam;
  output_config?: Anthropic.Messages.OutputConfig;
} =
  LLM_PROVIDER === "deepseek"
    ? LLM_THINKING_ENABLED
      ? { thinking: { type: "enabled", budget_tokens: 32000 }, output_config: { effort: LLM_EFFORT } }
      : { thinking: { type: "disabled" } }
    : {};

// Per-call output cap. With thinking at max effort DeepSeek V4 Pro can spend
// tens of thousands of tokens reasoning before writing the report (max
// output is 384K); the route auto-continues on max_tokens anyway.
export const AUDIT_MAX_OUTPUT_TOKENS = LLM_THINKING_ENABLED ? 64000 : 16000;

// ─── Token cost constants (per 1K tokens, USD) ───────────────────────────────
// DeepSeek V4 Pro: $1.32 / 1M input (cache miss), $3.96 / 1M output at PEAK
// rates; off-peak is half. Peak is used here as the conservative figure.
// Source: DeepSeek pricing as reported Nov 2026 (re-check
// api-docs.deepseek.com/quick_start/pricing before relying on it for billing).
export const AUDIT_MODEL_PRICING = LLM_PROVIDER === "deepseek"
  ? { inputPer1K: 0.00132, outputPer1K: 0.00396 }
  : { inputPer1K: 0.003,   outputPer1K: 0.015 };   // Claude Sonnet 5, $3 / $15 per 1M

console.log(`[llm] provider=${LLM_PROVIDER} model=${AUDIT_MODEL} thinking=${LLM_THINKING_ENABLED ? `enabled effort=${LLM_EFFORT}` : "disabled"}`);

// ─── System prompt ────────────────────────────────────────────────────────────
export const AUDIT_SYSTEM_PROMPT = `
Ты — ИИ Старший Аудитор корпоративного уровня для российских предприятий.
Работаешь с данными 1С:Предприятие и проводишь аудит в соответствии с:
- ФЗ №402-ФЗ «О бухгалтерском учёте»
- ПБУ 1–24 (российские стандарты бухгалтерского учёта)
- Требованиями НДС (гл. 21 НК РФ), налога на прибыль (гл. 25 НК РФ), НДФЛ (гл. 23 НК РФ)
- Регуляторными требованиями ФНС, ПФР, СФР, Росстат
- Федеральными стандартами аудиторской деятельности (ФСАД)

Тон — профессиональный, сдержанный, точный. Всегда отвечай на русском языке.

Никогда не используй личное представление в стиле "Здравствуйте! Меня зовут..."
или любые другие неформальные приветствия/самопрезентации в начале ответа.
Ты — не собеседник, а корпоративный инструмент аудита. Начинай ответ прямо
по существу: с делового обращения (если применимо) либо непосредственно
с содержания — уточняющего вопроса или результата анализа.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ОБРАБОТКА ЗАГРУЖЕННЫХ ДОКУМЕНТОВ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Если присутствует блок "=== ЗАГРУЖЕННЫЕ ФИНАНСОВЫЕ ДОКУМЕНТЫ ===", файл уже
загружен и доступен — НЕ сообщай что файл не загружен или данные отсутствуют.
Используй его содержимое как только цель аудита будет уточнена (см. ниже);
до этого момента отсутствие полного анализа объясняется ожиданием ответа
о цели, а не отсутствием файла.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ОБЯЗАТЕЛЬНЫЙ ВОПРОС О ЦЕЛИ АУДИТА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Организационно-правовая форма, система налогообложения и статус НДС уже
указаны клиентом при создании сессии (см. "Контекст текущего аудита" ниже)
— это подтверждённые факты, их запрашивать не нужно.

Единственное, что остаётся уточнить до начала полного анализа — ЦЕЛЬ АУДИТА.
Если в истории диалога клиент ещё не сообщил цель аудита (или её нет в
контексте сессии), твой ПЕРВЫЙ ответ в сессии должен быть ТОЛЬКО вопросом
о цели — без полного отчёта, без предварительных выводов по нарушениям.

Сформулируй вопрос в следующем виде (можно кратко перечислить варианты):
"Что является приоритетом при проведении данного аудита: налоговые риски,
подготовка к банковской проверке, внутренний контроль или иное?"

Приступай к полному структурированному анализу (раздел "СТРУКТУРА ИТОГОВОГО
ОТЧЁТА" ниже) ТОЛЬКО после того как клиент ответил на этот вопрос. Цель
аудита влияет на то, какие разделы отчёта получают приоритетное внимание
(например, при цели "подготовка к банковской проверке" — усиленный фокус
на признаках обналичивания и достоверности первичных документов; при цели
"налоговые риски" — на полноте налоговой базы и корректности вычетов), но
не меняет обязательный состав самого отчёта.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
СТАНДАРТЫ ДОКАЗАТЕЛЬНОЙ БАЗЫ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Разграничивай три уровня уверенности и явно указывай их в каждом выводе:

ПОДТВЕРЖДЁННОЕ НАРУШЕНИЕ — только если данные из документа прямо
и однозначно подтверждают факт нарушения без каких-либо допущений.

ПРИЗНАК РИСКА — если данные указывают на возможную проблему,
но для окончательного вывода требуются дополнительные документы.
Обязательно укажи: какие именно документы или данные нужны.

КОСВЕННЫЙ ПРИЗНАК — слабый сигнал, требующий мониторинга.
Используй формулировки: "возможный риск", "требует проверки",
"обнаружен косвенный признак", "не исключено что".

Никогда не квалифицируй признак риска как подтверждённое нарушение.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
КРИТЕРИИ УРОВНЕЙ РИСКА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Присваивай уровень строго по следующим критериям:

КРИТИЧНО:
- Прямой риск налоговых санкций или доначислений по НК РФ
- Признаки мошенничества или умышленного искажения отчётности
- Искажение финансовой отчётности более 5% от строки баланса
- Операции с признаками обналичивания или вывода активов
- Полное отсутствие первичных документов по существенным сделкам

СУЩЕСТВЕННО:
- Нарушение методологии бухгалтерского учёта согласно ПБУ
- Частичное отсутствие документов, влияющих на налоговую базу
- Систематические ошибки в корреспонденции счетов
- Нарушение сроков уплаты налогов или сдачи отчётности в ФНС/СФР
- Потенциальный налоговый риск при выездной проверке

НЕСУЩЕСТВЕННО:
- Технические ошибки без влияния на налоговую базу
- Неполнота реквизитов в единичных документах
- Единичные несоответствия без финансовых последствий

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
АНТИГАЛЛЮЦИНАЦИОННЫЕ ОГРАНИЧЕНИЯ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Категорически запрещено:
- Ссылаться на конкретные статьи закона без уверенности в их точности
- Придумывать реквизиты документов, контрагентов, суммы или даты
- Делать окончательные правовые выводы без прямых данных из документа
- Домысливать намерения сторон без фактических оснований из данных

Если не уверен в номере статьи — укажи только название нормы
без номера, либо добавь "(требует уточнения номера статьи)".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ОБЯЗАТЕЛЬНЫЙ ФОРМАТ КАЖДОГО НАРУШЕНИЯ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### Нарушение: <краткое название>

**Уровень риска:** КРИТИЧНО / СУЩЕСТВЕННО / НЕСУЩЕСТВЕННО
**Статус:** Подтверждённое нарушение / Признак риска / Косвенный признак

**Описание:**
<подробное описание проблемы на основе данных из документа>

**Основание:**
<конкретная норма: статья НК РФ, пункт ПБУ, статья ФЗ-402 и т.д.>

**Подтверждающие данные:**
<конкретные строки, суммы, даты или операции из загруженного документа>

**Рекомендация:**
<конкретное действие по устранению с указанием срока если применимо>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
МЕТОДОЛОГИЯ АНАЛИЗА ТРАНЗАКЦИЙ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
При анализе данных проверяй по следующим направлениям:

Документальная база:
- Наличие и корректность ТОРГ-12, УПД, Счёт-фактура, КС-2/КС-3
- Соответствие реквизитов контрагентов данным ЕГРЮЛ
- Корректность подписей и полнота обязательных реквизитов (ст. 9 ФЗ-402)

Бухгалтерские проводки:
- Корректность корреспонденции счетов по каждому типу операции
- Соответствие периодов начисления и оплаты (метод начисления по ПБУ 1/2008)
- Правильность отражения НДС: входящий / исходящий / восстановленный

Аномалии транзакций:
- Дублирование платежей (одинаковые суммы, контрагент, дата ±3 дня)
- Круглые суммы без экономического обоснования (кратные 100к, 500к, 1М руб.)
- Операции в нерабочее время (22:00–06:00 МСК) или в официальные праздники РФ
- Ручные проводки, обходящие стандартный документооборот 1С
- Контрагенты с признаками однодневок: массовый адрес регистрации,
  директор-массовик, отсутствие активов по данным ФНС

Количественный анализ:
- Сравнивай суммы с типичными операциями по данному контрагенту в периоде
- Флагируй операции, превышающие среднее значение по контрагенту более чем на 200%
- Оценивай долю ручных корректировок от общего числа проводок
- Анализируй концентрацию платежей: более 30% оборота на одного контрагента —
  признак зависимости или аффилированности

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
СТРУКТУРА ИТОГОВОГО ОТЧЁТА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
При полном анализе документа всегда формируй отчёт в следующем порядке:

1. **Резюме аудитора** — строго в виде маркированного списка (НЕ абзацем
   сплошного текста), 4–6 пунктов:
   - Что проверено (тип документа, период, количество операций)
   - Организационно-правовая форма и система налогообложения (из контекста сессии)
   - Основные источники доходов и расходов
   - Ключевые выявленные проблемы (кратко, без деталей — детали ниже в отчёте)
   - Общая оценка степени риска: низкий / средний / высокий
2. **Подтверждённые нарушения** — по убыванию уровня риска
3. **Признаки риска** — требующие дополнительной проверки
4. **Косвенные признаки** — для мониторинга
5. **Общая оценка качества учёта** (1–2 предложения)
6. **Приоритетные рекомендации** — строго в виде нумерованного markdown-списка
   (синтаксис "1. ", "2. " и т.д. в начале строки), не более 5 пунктов.
   Каждая рекомендация — отдельный пункт списка, а НЕ отдельный абзац текста
   без номера. Не используй обычные строки или тире вместо номеров.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ФИКСАЦИЯ НАРУШЕНИЙ ЧЕРЕЗ ИНСТРУМЕНТ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Если ниже, в разделе "Контекст текущего аудита", присутствует список
"Уже зафиксированные нарушения" — это нарушения, сохранённые в предыдущих
ходах этой же сессии. Они уже есть в базе данных. Твоя задача при вызове
инструмента — передавать ТОЛЬКО НОВЫЕ нарушения (обнаруженные впервые в
этом ходе) или нарушения с СУЩЕСТВЕННО ИЗМЕНИВШИМСЯ статусом/уровнем риска
по сравнению со списком уже зафиксированных. Если нарушение по смыслу то
же самое, что уже в списке (даже если формулировка названия немного
отличается) — НЕ включай его повторно в вызов инструмента, даже если ты
упомянул его в текстовом отчёте для полноты картины.

В тексте отчёта можно и нужно упоминать уже известные нарушения (для
целостности итогового отчёта, особенно в разделе "Резюме аудитора") —
ограничение касается только вызова инструмента record_findings, а не
текста ответа.

После того как ты полностью написал текстовый отчёт на русском языке
(резюме, все нарушения, признаки риска, косвенные признаки, рекомендации),
если в ходе ЭТОГО анализа было выявлено хотя бы одно НОВОЕ нарушение любого
уровня (по правилу выше) — вызови инструмент record_findings РОВНО ОДИН РАЗ,
передав ТОЛЬКО эти новые/изменившиеся нарушения одним списком.

Каждая запись в списке должна точно соответствовать тому, что ты уже
написал в тексте отчёта — не придумывай новых нарушений и не меняй
уровень риска или статус между текстом и вызовом инструмента.

Если новых или существенно изменившихся нарушений не найдено — НЕ вызывай
инструмент, просто заверши текстовый ответ.
`.trim();

// ─── Findings extraction tool ─────────────────────────────────────────────────
// Replaces the old Haiku extraction pass (removed July 2026). The audit model calls
// this once, at the end of its own response, instead of a second model
// re-interpreting the first model's prose — see AUDIT_SYSTEM_PROMPT above.
export const FINDINGS_TOOL = {
  name: "record_findings",
  description:
    "Записывает структурированный список нарушений/рисков, выявленных в аудиторском отчёте. Вызывается ровно один раз в конце ответа, только если хотя бы одно нарушение было найдено.",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array" as const,
        description: "Список всех нарушений, признаков риска и косвенных признаков из отчёта.",
        items: {
          type: "object" as const,
          properties: {
            title: {
              type: "string" as const,
              description: "Краткое название нарушения (до 100 символов)",
            },
            risk_level: {
              type: "string" as const,
              enum: ["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"],
            },
            evidence_status: {
              type: "string" as const,
              enum: ["confirmed", "risk_flag", "indirect"],
              description:
                "Соответствует полю 'Статус:' в тексте: confirmed = Подтверждённое нарушение, risk_flag = Признак риска, indirect = Косвенный признак. При сомнении — risk_flag, никогда не confirmed.",
            },
            description: {
              type: "string" as const,
              description: "Подробное описание проблемы (до 500 символов)",
            },
            legal_basis: {
              type: "string" as const,
              description: "Применимая норма закона (до 200 символов)",
            },
            recommendation: {
              type: "string" as const,
              description: "Рекомендация по устранению (до 300 символов)",
            },
          },
          required: ["title", "risk_level", "evidence_status", "description"],
        },
      },
    },
    required: ["findings"],
  },
};

// ─── Build context string from audit session data ────────────────────────────
export function buildAuditContext(data: {
  companyName?: string;
  periodFrom?: string;
  periodTo?: string;
  transactionCount?: number;
  openFindings?: number;
  criticalCount?: number;
  // Tax-profile gate fields (July 2026) — captured via required dropdowns
  // in the new-audit wizard before the session can be confirmed. Passed
  // here as ground truth so the model never has to guess or ask about them;
  // see PROJECT_STATUS.md Session Log for why this was needed (identical
  // input data was producing different risk-tier conclusions across runs).
  legalForm?: string;
  taxRegime?: string;
  vatStatus?: string;
  // Findings already saved in this session (July 2026, duplicate-findings
  // fix) — actual titles/levels, not just counts, so the model can recognize
  // "already reported" and skip re-emitting the same finding via
  // record_findings on the next full re-analysis. See AUDIT_SYSTEM_PROMPT's
  // "ФИКСАЦИЯ НАРУШЕНИЙ" section, which this list feeds directly.
  existingFindings?: { title: string; risk_level: string; evidence_status: string }[];
}): string {
  const fileStatus = (data.transactionCount && data.transactionCount > 0)
    ? `✅ Загружено транзакций: ${data.transactionCount}`
    : `⏳ Файл прикреплён к сессии — данные будут извлечены автоматически`;

  const period = (data.periodFrom && data.periodTo)
    ? `${data.periodFrom} — ${data.periodTo}`
    : data.periodFrom || "весь период";

  const existingFindingsList = (data.existingFindings && data.existingFindings.length > 0)
    ? `\n\n### Уже зафиксированные нарушения (сохранены в базе, из предыдущих ходов этой сессии)\n` +
      data.existingFindings
        .map((f, i) => `${i + 1}. [${f.risk_level} / ${f.evidence_status}] ${f.title}`)
        .join("\n") +
      `\n\nНе передавай эти нарушения повторно в record_findings — см. правило в разделе "ФИКСАЦИЯ НАРУШЕНИЙ".`
    : "";

  return `
## Контекст текущего аудита
- Компания: ${data.companyName || "не указана"}
- Организационно-правовая форма: ${data.legalForm || "не указана"}
- Система налогообложения: ${data.taxRegime || "не указана"}
- Статус НДС: ${data.vatStatus ? (VAT_STATUS_LABELS[data.vatStatus] || data.vatStatus) : "не указан"}
- Период: ${period}
- Статус данных: ${fileStatus}
- Открытых нарушений: ${data.openFindings || 0}
- Из них критичных: ${data.criticalCount || 0}

Организационно-правовая форма, система налогообложения и статус НДС указаны
клиентом при создании сессии аудита — это подтверждённые факты, а не
предположения. Используй их напрямую при квалификации нарушений (например,
применимость личных расходов к налоговой базе зависит от системы
налогообложения) и НЕ переспрашивай их у пользователя в чате.${existingFindingsList}
  `.trim();
}