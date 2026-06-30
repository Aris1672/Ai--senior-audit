// ─── Pricing tier structure ───────────────────────────────────────────────────
export interface PricingTier {
  id:             string;
  name:           string;
  maxTransactions: number;
  priceRub:       number;
  description:    string;
}

// ─── Client billing state ────────────────────────────────────────────────────
export interface ClientBilling {
  tier:            PricingTier;
  effectivePrice:  number;   // custom override or tier default
  effectiveMaxTx:  number;   // custom override or tier default
  auditsRemaining: number;
  auditsPurchased: number;
  auditsUsed:      number;
  validTo:         string | null;
}

// ─── Usage breakdown shown on client Usage tab ───────────────────────────────
export interface UsageBreakdown {
  aiMessages:           number;
  tokensIn:             number;
  tokensOut:            number;
  documentsUploaded:    number;
  transactionsAnalyzed: number;
  totalCostRub:         number;
  sessionCosts: {
    sessionId: string;
    title:     string;
    costRub:   number;
  }[];
}

// ─── Risk level type (matches DB enum) ───────────────────────────────────────
export type RiskLevel = "КРИТИЧНО" | "СУЩЕСТВЕННО" | "НЕСУЩЕСТВЕННО";

// ─── Evidence-confidence type (matches DB enum `finding_evidence_status`) ────
// Distinct from RiskLevel (severity) and from a finding's workflow `status`
// (open/resolved/disputed). This tracks how certain the AI is, per the
// three-tier system in AUDIT_SYSTEM_PROMPT: confirmed / risk_flag / indirect.
export type EvidenceStatus = "confirmed" | "risk_flag" | "indirect";

// ─── Format number as Russian rubles ─────────────────────────────────────────
export function formatRubles(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style:                 "currency",
    currency:              "RUB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─── Calculate AI cost in rubles ─────────────────────────────────────────────
// Claude Haiku 4.5: $0.025 per 1K input, $0.125 per 1K output
export function calcAiCostRub(
  tokensIn:  number,
  tokensOut: number,
  usdToRub = 90
): number {
  const INPUT_PER_1K  = 0.025;
  const OUTPUT_PER_1K = 0.125;
  const costUsd = (tokensIn  / 1000 * INPUT_PER_1K) +
                  (tokensOut / 1000 * OUTPUT_PER_1K);
  return costUsd * usdToRub;
}

// ─── Get risk level color for UI badges ──────────────────────────────────────
export function getRiskColor(level: RiskLevel): string {
  switch (level) {
    case "КРИТИЧНО":       return "#e84040";
    case "СУЩЕСТВЕННО":    return "#f59e0b";
    case "НЕСУЩЕСТВЕННО":  return "#2ecc8f";
  }
}

// ─── Get risk level background color (lighter) ───────────────────────────────
export function getRiskBgColor(level: RiskLevel): string {
  switch (level) {
    case "КРИТИЧНО":       return "#3d1515";
    case "СУЩЕСТВЕННО":    return "#3d2e0a";
    case "НЕСУЩЕСТВЕННО":  return "#0e3d2a";
  }
}

// ─── Get human-readable Russian label for evidence-confidence tier ───────────
export function getEvidenceStatusLabel(status: EvidenceStatus): string {
  switch (status) {
    case "confirmed": return "Подтверждённое нарушение";
    case "risk_flag":  return "Признак риска";
    case "indirect":   return "Косвенный признак";
  }
}

// ─── Get evidence-confidence color for UI badges ──────────────────────────────
// Deliberately a different palette axis from risk-level color (severity),
// so the two badges never get visually confused with each other.
export function getEvidenceStatusColor(status: EvidenceStatus): string {
  switch (status) {
    case "confirmed": return "#e8edf8";
    case "risk_flag":  return "#4d91ff";
    case "indirect":   return "#7a90c0";
  }
}

export function getEvidenceStatusBgColor(status: EvidenceStatus): string {
  switch (status) {
    case "confirmed": return "#1a2340";
    case "risk_flag":  return "#0d1f3e";
    case "indirect":   return "#101828";
  }
}

// ─── Check if a client has exceeded their transaction limit ──────────────────
export function checkTierLimit(
  transactionCount: number,
  effectiveMaxTx:   number
): { allowed: boolean; percentUsed: number; remaining: number } {
  const percentUsed = Math.round((transactionCount / effectiveMaxTx) * 100);
  const remaining   = Math.max(0, effectiveMaxTx - transactionCount);
  return {
    allowed:     transactionCount <= effectiveMaxTx,
    percentUsed: Math.min(percentUsed, 100),
    remaining,
  };
}

// ─── Suggest upgrade tier based on transaction count ─────────────────────────
export function suggestTier(transactionCount: number): string {
  if (transactionCount <= 500)   return "Базовый — 8 000 ₽";
  if (transactionCount <= 2000)  return "Стандарт — 15 000 ₽";
  if (transactionCount <= 5000)  return "Профи — 30 000 ₽";
  return "Корпоратив — 75 000 ₽";
}
