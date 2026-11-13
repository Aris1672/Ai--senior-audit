/**
 * lib/doc-billing-server.ts — server side of per-document billing:
 * who is asking, what rates apply, what the audit already contains,
 * and recording a confirmed (or declined) quote.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { createAdminClient } from "./supabase-server";
import { parseFile, type DateRange, type ParseResult } from "./file-parser";
import { mergeKeyLists } from "./operation-keys";
import { DEFAULT_PAGE_RATE_RUB, PAGE_KINDS, NOT_READ_KINDS } from "./doc-billing";
import { ocrSidecarPath } from "./ocr";

type Admin = ReturnType<typeof createAdminClient>;

// ─── Who is asking ───────────────────────────────────────────────────────────
/** The signed-in user from the session cookie, or null. Never trusts an id sent in the request body. */
export async function getAuthUser(): Promise<{ id: string } | null> {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name) { return cookieStore.get(name)?.value; }, set() {}, remove() {} } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    return user ? { id: user.id } : null;
  } catch {
    return null;
  }
}

export interface SessionAccess {
  userId: string;
  isAdmin: boolean;
  session: { id: string; client_id: string; status: string; period_from: string | null; period_to: string | null };
}

/**
 * The signed-in user may act on this audit only if it is theirs (or they are
 * an admin). Returns an error {status, error} otherwise.
 */
export async function authorizeSession(
  supabase: Admin, sessionId: string | null | undefined
): Promise<SessionAccess | { status: number; error: string }> {
  const user = await getAuthUser();
  if (!user) return { status: 401, error: "Требуется вход в систему" };
  if (!sessionId) return { status: 400, error: "Не указан аудит" };

  const [{ data: session }, { data: profile }] = await Promise.all([
    supabase.from("audit_sessions").select("id, client_id, status, period_from, period_to").eq("id", sessionId).maybeSingle(),
    supabase.from("profiles").select("role, status").eq("id", user.id).maybeSingle(),
  ]);
  if (!session) return { status: 404, error: "Аудит не найден" };
  const isAdmin = profile?.role === "admin";
  if (!isAdmin && session.client_id !== user.id) return { status: 403, error: "Нет доступа к этому аудиту" };
  return { userId: user.id, isAdmin, session };
}

export const isAccessError = (a: SessionAccess | { status: number; error: string }): a is { status: number; error: string } =>
  (a as { error?: string }).error !== undefined;

// ─── Is the database ready ───────────────────────────────────────────────────
// The billing columns come from migration 005. Until it has been run the app
// must keep working as before, so every caller asks first.
let schemaReady: boolean | null = null;
let schemaCheckedAt = 0;

export async function billingSchemaReady(supabase: Admin): Promise<boolean> {
  if (schemaReady === true) return true;
  if (schemaReady === false && Date.now() - schemaCheckedAt < 60_000) return false;
  const { error } = await supabase.from("documents").select("billing_status").limit(1);
  schemaReady = !error;
  schemaCheckedAt = Date.now();
  if (error) {
    console.warn("[billing] ⚠ migration 005_document_billing.sql has NOT been run — " +
      "documents are not quoted or confirmed, and files added in chat are analysed without being priced.");
  }
  return schemaReady;
}

// ─── Rates ───────────────────────────────────────────────────────────────────
export interface Rates { operationRateRub: number; isCustomRate: boolean; pageRateRub: number }

export async function resolveRates(supabase: Admin, clientId: string): Promise<Rates | null> {
  let operationRateRub: number | null = null;
  let isCustomRate = false;

  const { data: sub } = await supabase
    .from("client_subscriptions").select("custom_price_rub")
    .eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (sub?.custom_price_rub != null) { operationRateRub = Number(sub.custom_price_rub); isCustomRate = true; }

  // select("*") so a missing price_per_page_rub column is not an error.
  const { data: settings } = await supabase.from("billing_settings").select("*").eq("id", 1).maybeSingle();
  if (operationRateRub == null) {
    if (settings?.price_per_transaction_rub == null) return null;
    operationRateRub = Number(settings.price_per_transaction_rub);
  }
  const page = Number(settings?.price_per_page_rub);
  return { operationRateRub, isCustomRate, pageRateRub: Number.isFinite(page) && page >= 0 ? page : DEFAULT_PAGE_RATE_RUB };
}

// ─── What the audit already contains ─────────────────────────────────────────
export function sha256(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

const OPERATION_TYPES = new Set(["xlsx", "xls", "csv", "1c_txt", "1c_odata"]);

/**
 * Operation keys of every ACCEPTED file of the audit (merged, so operations
 * repeated between those files count once), plus the hashes of those files.
 * Files are re-read from storage: keys are not stored anywhere.
 */
export async function loadAcceptedContent(
  supabase: Admin, sessionId: string, period: DateRange | undefined, exceptDocumentId?: string
): Promise<{ knownKeys: Map<string, number>; hashes: Set<string> }> {
  const { data: docs } = await supabase
    .from("documents")
    .select("id, file_type, storage_path, content_hash, billing_kind")
    .eq("session_id", sessionId)
    .eq("billing_status", "confirmed");

  const hashes = new Set<string>();
  const lists: string[][] = [];
  for (const doc of docs ?? []) {
    if (doc.id === exceptDocumentId) continue;
    // A file that was not read (no recognition then, or the service was down)
    // is not a repeat when uploaded again — it is priced and read afresh.
    if (doc.content_hash && !NOT_READ_KINDS.has(doc.billing_kind ?? "")) hashes.add(doc.content_hash);
    if (!OPERATION_TYPES.has(doc.file_type) || !doc.storage_path) continue;
    const { data: blob } = await supabase.storage.from("audit-documents").download(doc.storage_path);
    if (!blob) continue;
    const buffer = await blob.arrayBuffer();
    if (!doc.content_hash) hashes.add(sha256(buffer));   // files from before migration 005
    try {
      const parsed: ParseResult = await parseFile(buffer, doc.file_type as "xlsx" | "xls" | "csv" | "1c_txt" | "1c_odata", period);
      if (parsed.operationKeys?.length) lists.push(parsed.operationKeys);
    } catch (err) {
      console.error("[billing] could not re-read an accepted file for the overlap check:", (err as Error)?.message);
    }
  }
  return { knownKeys: mergeKeyLists(lists), hashes };
}

// ─── Confirm or decline ──────────────────────────────────────────────────────
export interface ConfirmResult {
  confirmed: number;
  declined: number;
  addedRub: number;
  session: { costRub: number; operations: number; pages: number };
}

/**
 * Accepts (or declines) quoted documents of one audit and adds the accepted
 * amounts to the audit's recorded totals. Amounts come from the document
 * rows written at upload — never from the caller. Each document moves out of
 * "pending" exactly once (the status change is conditional), so a repeated
 * call cannot charge twice.
 * @param documentIds null = every pending document of the audit
 */
export async function settleDocuments(
  supabase: Admin, sessionId: string, documentIds: string[] | null, accept: boolean
): Promise<ConfirmResult> {
  let q = supabase.from("documents")
    .update(accept
      ? { billing_status: "confirmed", billing_confirmed_at: new Date().toISOString() }
      : { billing_status: "declined" })
    .eq("session_id", sessionId)
    .eq("billing_status", "pending");
  if (documentIds) q = q.in("id", documentIds);
  const { data: moved, error } = await q.select("id, storage_path, billing_kind, billing_new_units, billing_amount_rub");
  if (error) throw new Error(`settleDocuments: ${error.message}`);

  const rows = moved ?? [];
  let addedRub = 0, addedOps = 0, addedPages = 0;
  if (accept) {
    for (const r of rows) {
      addedRub += Number(r.billing_amount_rub ?? 0);
      if (r.billing_kind === "operations") addedOps += Number(r.billing_new_units ?? 0);
      if (PAGE_KINDS.has(r.billing_kind)) addedPages += Number(r.billing_new_units ?? 0);
    }
  } else {
    // A declined file is not kept: it was never analysed and never will be.
    // The recognised text of a scan (if any) is removed with it.
    const paths = (rows.map(r => r.storage_path).filter(Boolean) as string[]).flatMap(p => [p, ocrSidecarPath(p)]);
    if (paths.length) await supabase.storage.from("audit-documents").remove(paths);
  }

  const { data: s } = await supabase.from("audit_sessions")
    .select("cost_rub, transactions_ct, pages_ct").eq("id", sessionId).single();
  const totals = {
    costRub:    Math.round((Number(s?.cost_rub ?? 0) + addedRub) * 100) / 100,
    operations: Number(s?.transactions_ct ?? 0) + addedOps,
    pages:      Number(s?.pages_ct ?? 0) + addedPages,
  };
  if (accept && rows.length > 0) {
    await supabase.from("audit_sessions")
      .update({ cost_rub: totals.costRub, transactions_ct: totals.operations, pages_ct: totals.pages })
      .eq("id", sessionId);
  }
  return { confirmed: accept ? rows.length : 0, declined: accept ? 0 : rows.length, addedRub: Math.round(addedRub * 100) / 100, session: totals };
}
