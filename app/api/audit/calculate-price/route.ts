/**
 * app/api/audit/calculate-price/route.ts
 *
 * Counts transactions from a parsed document or a live 1C connection,
 * then prices the audit as (transaction count) x (rate per transaction).
 * Rate is the client's custom override (client_subscriptions.custom_price_rub)
 * if set, otherwise the global default (billing_settings.price_per_transaction_rub).
 *
 * Transaction count is always scoped to the session's audit period
 * (audit_sessions.period_from/period_to) — see /api/upload and
 * lib/file-parser.ts for where the actual date filtering happens.
 *
 * POST { sessionId, documentId? } | { sessionId, c1Config? }
 * -> { transactionCount, priceRub, rateRub, isCustomRate, pages?, lines? }
 *
 * Nov 2026: the caller must be signed in and own the audit (the client id
 * comes from the audit, not from the request). In file mode the answer is
 * the quote already computed and stored by /api/upload for the documents
 * awaiting confirmation — this route no longer writes a price; the amount is
 * recorded when the client confirms (lib/doc-billing-server.ts).
 */

import { createAdminClient } from "@/lib/supabase-server";
import { parseFile, toParsedSummary } from "@/lib/file-parser";
import { calcAuditPrice } from "@/lib/billing";
import { NextRequest, NextResponse } from "next/server";
import { describeQuote, type DocumentQuote } from "@/lib/doc-billing";
import { authorizeSession, isAccessError, billingSchemaReady } from "@/lib/doc-billing-server";

export async function POST(req: NextRequest) {
  try {
    const { documentId, sessionId, c1Config } = await req.json();
    const supabase = createAdminClient();

    const access = await authorizeSession(supabase, sessionId);
    if (isAccessError(access)) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const clientId = access.session.client_id;

    // --- Resolve rate: client override -> global default -----------------
    let rateRub = 0;
    let isCustomRate = false;

    if (clientId) {
      const { data: sub } = await supabase
        .from("client_subscriptions")
        .select("custom_price_rub")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sub?.custom_price_rub != null) {
        rateRub = Number(sub.custom_price_rub);
        isCustomRate = true;
      }
    }

    if (!isCustomRate) {
      const { data: settings } = await supabase
        .from("billing_settings")
        .select("price_per_transaction_rub")
        .eq("id", 1)
        .single();

      if (!settings) {
        return NextResponse.json(
          { error: "Тариф не настроен. Обратитесь к администратору." },
          { status: 500 }
        );
      }
      rateRub = Number(settings.price_per_transaction_rub);
    }

    // --- Look up the audit period for this session ------------------------
    // Single source of truth: written once by create_audit_session, read
    // here (and by /api/upload, /api/parse-file, /api/chat) so pricing and
    // AI analysis always agree on which rows count.
    let period: { dateFrom?: string; dateTo?: string } | undefined;
    if (sessionId) {
      const { data: session } = await supabase
        .from("audit_sessions")
        .select("period_from, period_to")
        .eq("id", sessionId)
        .single();
      if (session) {
        period = { dateFrom: session.period_from ?? undefined, dateTo: session.period_to ?? undefined };
      }
    }

    let transactionCount = 0;

    // --- FILE MODE, per-document billing ------------------------------------
    // The quote was computed from the stored file at upload. Report what is
    // awaiting confirmation; nothing is recorded here.
    if (documentId && await billingSchemaReady(supabase)) {
      const { data: pending } = await supabase
        .from("documents")
        .select("file_name, billing_kind, billing_units, billing_new_units, billing_rate_rub, billing_amount_rub")
        .eq("session_id", sessionId)
        .eq("billing_status", "pending")
        .order("uploaded_at", { ascending: true });

      let priceRub = 0, operations = 0, pages = 0;
      const lines: string[] = [];
      for (const d of pending ?? []) {
        const q: DocumentQuote = {
          kind: d.billing_kind, units: d.billing_units ?? 0, newUnits: d.billing_new_units ?? 0,
          rateRub: Number(d.billing_rate_rub ?? 0), amountRub: Number(d.billing_amount_rub ?? 0),
        };
        priceRub += q.amountRub;
        if (q.kind === "operations") operations += q.newUnits;
        if (q.kind === "pages")      pages += q.newUnits;
        lines.push(describeQuote(d.file_name, q));
      }
      return NextResponse.json({
        transactionCount: operations, pages, lines,
        priceRub: Math.round(priceRub * 100) / 100, rateRub, isCustomRate,
      });
    }

    // --- FILE MODE, before migration 005 (old behaviour) --------------------
    if (documentId) {
      const { data: doc } = await supabase
        .from("documents")
        .select("parsed_data, status, file_type, storage_path")
        .eq("id", documentId)
        .single();

      if (doc?.parsed_data?.rowCount != null) {
        // Already parsed -- use cached value (fast path). Cached value was
        // produced by /api/upload's background parse, which already applied
        // the same period filter, so this stays consistent.
        transactionCount = doc.parsed_data.rowCount;

      } else if (["xlsx", "csv", "xml"].includes(doc?.file_type ?? "")) {
        // Not yet ready -- download and parse now (Vercel -> Supabase)
        const { data: blob, error: dlErr } = await supabase.storage
          .from("audit-documents")
          .download(doc!.storage_path);

        if (dlErr || !blob) {
          return NextResponse.json(
            { error: "Не удалось загрузить файл для подсчёта строк" },
            { status: 500 }
          );
        }

        const buffer = await blob.arrayBuffer();
        const result = await parseFile(
          buffer,
          doc!.file_type as "xlsx" | "csv" | "xml",
          period
        );

        transactionCount = result.rowCount;

        // Cache the result
        await supabase
          .from("documents")
          .update({ parsed_data: toParsedSummary(result), status: "ready" })
          .eq("id", documentId);
      }
    }

    // --- LIVE 1C MODE ---------------------------------------------------------
    // Replaced Nov 2026: a 1C base is read by /api/audit/connect-1c, which
    // stores a snapshot as a document of the audit; its price then comes
    // through the per-document path above. The old code here only counted
    // one document type, with no period, and priced on that.
    else if (c1Config) {
      return NextResponse.json(
        { error: "Подключение 1С выполняется через /api/audit/connect-1c." },
        { status: 400 }
      );
    }

    // --- Price & persist --------------------------------------------------
    const priceRub = calcAuditPrice(transactionCount, rateRub);

    if (sessionId) {
      await supabase
        .from("audit_sessions")
        .update({
          transactions_ct: transactionCount,
          cost_rub:        priceRub,
        })
        .eq("id", sessionId);
    }

    return NextResponse.json({ transactionCount, priceRub, rateRub, isCustomRate });

  } catch (err) {
    console.error("[calculate-price] error:", err);
    return NextResponse.json({ error: "Ошибка расчёта стоимости" }, { status: 500 });
  }
}
