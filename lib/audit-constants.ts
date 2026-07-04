/**
 * lib/audit-constants.ts
 *
 * Single source of truth for the tax-profile dropdown options captured on
 * every new audit session (legal form, tax regime, VAT status). Used by:
 * - app/client/audit/new/page.tsx  (dropdown rendering)
 * - app/api/data/route.ts          (server-side enum validation — the actual
 *                                    gate; never trust the dropdown alone)
 *
 * Added July 2026 as part of the app-level clarifying-questions gate — see
 * PROJECT_STATUS.md Session Log for the reasoning (same input data was
 * producing different risk-tier conclusions across runs, partly traced to
 * the AI guessing at tax regime instead of being told it as a fact).
 */

export const LEGAL_FORMS = [
  { value: "ООО",  label: "ООО — Общество с ограниченной ответственностью" },
  { value: "АО",   label: "АО — Акционерное общество" },
  { value: "ПАО",  label: "ПАО — Публичное акционерное общество" },
  { value: "НАО",  label: "НАО — Непубличное акционерное общество" },
  { value: "ИП",   label: "ИП — Индивидуальный предприниматель" },
  { value: "ГУП",  label: "ГУП — Государственное унитарное предприятие" },
  { value: "МУП",  label: "МУП — Муниципальное унитарное предприятие" },
  { value: "КФХ",  label: "КФХ — Крестьянское (фермерское) хозяйство" },
  { value: "Производственный кооператив", label: "Производственный кооператив" },
  { value: "Полное товарищество",         label: "Полное товарищество" },
  { value: "Товарищество на вере",        label: "Товарищество на вере" },
  { value: "Хозяйственное партнерство",   label: "Хозяйственное партнерство" },
  { value: "Другое", label: "Другое" },
] as const;

export const TAX_REGIMES = [
  { value: "ОСНО",                  label: "ОСНО" },
  { value: "УСН (Доходы)",          label: "УСН (Доходы)" },
  { value: "УСН (Доходы − Расходы)", label: "УСН (Доходы − Расходы)" },
  { value: "АУСН (Доходы)",          label: "АУСН (Доходы)" },
  { value: "АУСН (Доходы − Расходы)", label: "АУСН (Доходы − Расходы)" },
  { value: "ЕСХН", label: "ЕСХН" },
  { value: "ПСН",  label: "ПСН" },
  { value: "НПД",  label: "НПД" },
  { value: "Другое", label: "Другое" },
] as const;

export const VAT_STATUSES = [
  { value: "payer",    label: "Плательщик НДС" },
  { value: "exempt",   label: "Освобождён от уплаты НДС" },
  { value: "not_taxed", label: "НДС не облагается" },
] as const;

// Value sets for fast server-side validation (Set.has() over array.find())
export const LEGAL_FORM_VALUES  = new Set(LEGAL_FORMS.map(o => o.value));
export const TAX_REGIME_VALUES  = new Set(TAX_REGIMES.map(o => o.value));
export const VAT_STATUS_VALUES  = new Set(VAT_STATUSES.map(o => o.value));

// Human-readable label lookup for VAT status (the other two use "Другое" +
// free text instead, so the raw stored value already reads fine to a human).
export const VAT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  VAT_STATUSES.map(o => [o.value, o.label])
);
