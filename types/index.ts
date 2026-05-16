// types/index.ts
// Central type definitions for AI Senior Auditor

// ─── Database row shapes ──────────────────────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  full_name?: string;
  company_name?: string;
  inn?: string;
  role: "admin" | "client";
  status: "active" | "suspended" | "deleted";
  created_at: string;
  updated_at?: string;
}

export interface PricingTier {
  id: string;
  name: string;
  max_transactions: number;
  price_rub: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface ClientSubscription {
  id: string;
  client_id: string;
  tier_id?: string;
  audits_purchased: number;
  audits_used: number;
  custom_price_rub?: number;
  custom_max_tx?: number;
  status: "active" | "inactive";
  created_at: string;
}

export interface AuditSession {
  id: string;
  client_id: string;
  title: string;
  status: "active" | "processing" | "complete" | "error";
  source?: "file" | "1c";
  transactions_ct: number;
  findings_ct?: number;
  cost_rub?: number;
  price_rub?: number;
  tier_name?: string;
  created_at: string;
  updated_at?: string;
}

export interface Document {
  id: string;
  client_id: string;
  session_id: string;
  file_name: string;
  file_type: "xlsx" | "csv" | "xml" | "pdf" | "docx" | "image";
  file_size: number;
  storage_path: string;
  status: "processing" | "ready" | "error";
  parsed_data?: import("@/lib/file-parser").ParseResult;
  uploaded_at?: string;
  created_at?: string;
}

export interface Finding {
  id: string;
  session_id: string;
  client_id: string;
  title: string;
  risk_level: "low" | "medium" | "high" | "critical";
  status: "open" | "resolved";
  description?: string;
  created_at: string;
}

export interface AuditMessage {
  id: string;
  session_id: string;
  client_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface UsageEvent {
  id: string;
  client_id: string;
  session_id?: string;
  event_type: "document_upload" | "audit_start" | "chat_message" | "report_generated";
  tokens_in?: number;
  tokens_out?: number;
  cost_rub?: number;
  transactions_ct?: number;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// ─── API shapes ───────────────────────────────────────────────────────────────

export interface C1Config {
  url: string;
  username: string;
  password: string;
  base: string;
}

export interface CalculatePriceRequest {
  sessionId: string;
  clientId: string;
  documentId?: string;
  c1Config?: C1Config;
}

export interface CalculatePriceResponse {
  transactionCount: number;
  priceRub: number;
  tierName: string;
}

export interface UploadResponse {
  documentId: string;
  storagePath: string;
  fileType: string;
  parseable: boolean;
  status: "processing" | "ready";
  message: string;
}

export interface ParseFileResponse {
  documentId: string;
  rowCount: number;
  parseMethod: import("@/lib/file-parser").ParseMethod;
  sheetName?: string;
  detectedColumns?: string[];
  xmlElement?: string;
}

export type ApiError = { error: string };
