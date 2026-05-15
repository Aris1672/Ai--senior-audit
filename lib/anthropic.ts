import Anthropic from "@anthropic-ai/sdk";

// ─── Only runs server-side on Vercel ─────────────────────────────────────────
// API key never reaches the client browser or Russia
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// ─── Token cost constants for Claude Haiku 4.5 ───────────────────────────────
export const HAIKU_PRICING = {
  inputPer1K:  0.025,   // USD
  outputPer1K: 0.125,   // USD
};

// ─── System prompt (Russian auditor) ─────────────────────────────────────────
export const AUDIT_SYSTEM_PROMPT = `
Ты — ИИ Старший Аудитор корпоративного уровня для российских предприятий.
Работаешь с данными 1С:Предприятие и проводишь аудит в соответствии с:
- ФЗ №402-ФЗ «О бухгалтерском учёте»
- ПБУ 1–24 (российские стандарты бухгалтерского учёта)
- Требованиями НДС, налога на прибыль и НДФЛ
- Регуляторными требованиями ФНС, ПФР, ФСС, Росстат

Всегда отвечай на русском языке.

Для каждого выявленного нарушения обязательно указывай:
1. Краткое название нарушения
2. Подробное описание проблемы
3. Применимую норму законодательства (конкретная статья или пункт)
4. Уровень риска (выбери одно): КРИТИЧНО / СУЩЕСТВЕННО / НЕСУЩЕСТВЕННО
5. Конкретную рекомендацию по устранению

При анализе транзакций всегда проверяй:
- Наличие и корректность первичных документов (ТОРГ-12, УПД, Счёт-фактура, КС-2/КС-3)
- Корректность корреспонденции счетов бухгалтерского учёта
- Соответствие периодов начисления и оплаты
- Признаки дублирования платежей
- Признаки фиктивных операций (круглые суммы, нетипичные контрагенты)
- Ручные проводки, обходящие стандартный документооборот
- Операции в нерабочее время или нерабочие дни
`.trim();

// ─── Build context string from audit session data ────────────────────────────
export function buildAuditContext(data: {
  companyName?: string;
  periodFrom?: string;
  periodTo?: string;
  transactionCount?: number;
  openFindings?: number;
  criticalCount?: number;
}): string {
  return `
## Контекст текущего аудита
- Компания: ${data.companyName || "не указана"}
- Период: ${data.periodFrom || "?"} — ${data.periodTo || "?"}
- Транзакций загружено: ${data.transactionCount || 0}
- Открытых нарушений: ${data.openFindings || 0}
- Из них критичных: ${data.criticalCount || 0}
  `.trim();
}