// --- Client billing state ----------------------------------------------
export interface ClientBilling {
  ratePerTransactionRub: number;   // custom override or global default
  isCustomRate:          boolean;  // true if client has a per-client override set
}

// --- Usage breakdown shown on client Usage tab --------------------------
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

// --- Risk level type (matches DB enum) -----------------------------------
export type RiskLevel = "КРИТИЧНО" | "СУЩЕСТВЕННО" | "НЕСУЩЕСТВЕННО";

// --- Evidence-confidence type (matches DB enum `finding_evidence_status`) --
export type EvidenceStatus = "confirmed" | "risk_flag" | "indirect";

// --- Format number as Russian rubles --------------------------------------
export function formatRubles(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style:                 "currency",
    currency:              "RUB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// --- Calculate audit price from transaction count + rate -----------------
// Replaces the old tier-lookup (calcPrice against pricing_tiers). Rate is
// rubles per transaction — either the client's custom_price_rub override
// (client_subscriptions) or the global billing_settings.price_per_transaction_rub.
export function calcAuditPrice(
  transactionCount: number,
  ratePerTransactionRub: number
): number {
  return Math.round(transactionCount * ratePerTransactionRub * 100) / 100;
}

// --- Calculate AI cost in rubles ------------------------------------------
// Claude Haiku 4.5: $0.025 per 1K input, $0.125 per 1K output
// NOTE: unrelated to client billing above — this is internal AI token-cost
// tracking (see PUNCH_LIST.md P2 item on reconciling this against Sonnet-only
// pricing; left untouched here, out of scope for this change).
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

// --- Get risk level color for UI badges -----------------------------------
export function getRiskColor(level: RiskLevel): string {
  switch (level) {
    case "КРИТИЧНО":       return "#e84040";
    case "СУЩЕСТВЕННО":    return "#f59e0b";
    case "НЕСУЩЕСТВЕННО":  return "#2ecc8f";
  }
}

// --- Get risk level background color (lighter) ----------------------------
export function getRiskBgColor(level: RiskLevel): string {
  switch (level) {
    case "КРИТИЧНО":       return "#3d1515";
    case "СУЩЕСТВЕННО":    return "#3d2e0a";
    case "НЕСУЩЕСТВЕННО":  return "#0e3d2a";
  }
}

// --- Get human-readable Russian label for evidence-confidence tier -------
export function getEvidenceStatusLabel(status: EvidenceStatus): string {
  switch (status) {
    case "confirmed": return "Подтверждённое нарушение";
    case "risk_flag":  return "Признак риска";
    case "indirect":   return "Косвенный признак";
  }
}

// --- Get evidence-confidence color for UI badges ---------------------------
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
