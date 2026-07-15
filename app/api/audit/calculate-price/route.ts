/**
 * app/api/audit/calculate-price/route.ts
 *
 * Counts transactions from a parsed document or a live 1C connection,
 * then prices the audit as (transaction count) x (rate per transaction).
 * Rate is the client's custom override (client_subscriptions.custom_price_rub)
 * if set, otherwise the global default (billing_settings.price_per_transaction_rub).
 *
 * POST { sessionId, clientId, documentId? } | { sessionId, clientId, c1Config? }
 * -> { transactionCount, priceRub, rateRub, isCustomRate }
 */

import { createAdminClient } from "@/lib/supabase-server";
import { parseFile } from "@/lib/file-parser";
import { calcAuditPrice } from "@/lib/billing";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { documentId, sessionId, clientId, c1Config } = await req.json();
    const supabase = createAdminClient();

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

    let transactionCount = 0;

    // --- FILE MODE ----------------------------------------------------------
    if (documentId) {
      const { data: doc } = await supabase
        .from("documents")
        .select("parsed_data, status, file_type, storage_path")
        .eq("id", documentId)
        .single();

      if (doc?.parsed_data?.rowCount != null) {
        // Already parsed -- use cached value (fast path)
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
          doc!.file_type as "xlsx" | "csv" | "xml"
        );

        transactionCount = result.rowCount;

        // Cache the result
        await supabase
          .from("documents")
          .update({ parsed_data: result, status: "ready" })
          .eq("id", documentId);
      }
    }

    // --- LIVE 1C MODE ---------------------------------------------------------
    else if (c1Config) {
      const { url, username, password, base } = c1Config;
      const auth = Buffer.from(`${username}:${password}`).toString("base64");
      const endpoint =
        `${url}/${base}/odata/standard.odata` +
        `/Document_ПоступлениеТоваровУслуг?$count=true&$top=0&$format=json`;

      try {
        const c1Res = await fetch(endpoint, {
          headers: { Authorization: `Basic ${auth}` },
          signal:  AbortSignal.timeout(10_000),
        });

        if (!c1Res.ok) {
          return NextResponse.json(
            { error: "Не удалось подключиться к 1С. Проверьте настройки." },
            { status: 400 }
          );
        }

        const c1Data = await c1Res.json();
        transactionCount = c1Data["@odata.count"] ?? 0;

      } catch {
        return NextResponse.json(
          { error: "Превышено время ожидания 1С. Проверьте доступность сервера." },
          { status: 400 }
        );
      }
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
