/**
 * app/api/audit/calculate-price/route.ts
 *
 * Counts transactions from a parsed document or a live 1C connection,
 * then maps the count to a pricing tier.
 *
 * POST { sessionId, clientId, documentId? } | { sessionId, clientId, c1Config? }
 * → { transactionCount, priceRub, tierName }
 */

import { createAdminClient } from "@/lib/supabase-server";
import { parseFile } from "@/lib/file-parser";
import { NextRequest, NextResponse } from "next/server";

// ─── Pricing ──────────────────────────────────────────────────────────────────

function calcPrice(
  txCount: number,
  tiers: { name: string; max_transactions: number; price_rub: number }[]
): { priceRub: number; tierName: string } {
  const sorted = [...tiers].sort((a, b) => a.max_transactions - b.max_transactions);
  for (const tier of sorted) {
    if (txCount <= tier.max_transactions) {
      return { priceRub: tier.price_rub, tierName: tier.name };
    }
  }
  const top = sorted[sorted.length - 1];
  return { priceRub: top.price_rub, tierName: `${top.name} (превышен лимит)` };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { documentId, sessionId, clientId, c1Config } = await req.json();
    const supabase = createAdminClient();

    // ── Load active pricing tiers ─────────────────────────────────────────
    const { data: tiers } = await supabase
      .from("pricing_tiers")
      .select("name, max_transactions, price_rub")
      .eq("is_active", true);

    if (!tiers || tiers.length === 0) {
      return NextResponse.json(
        { error: "Тарифы не настроены. Обратитесь к администратору." },
        { status: 500 }
      );
    }

    let transactionCount = 0;

    // ── FILE MODE ─────────────────────────────────────────────────────────
    if (documentId) {
      const { data: doc } = await supabase
        .from("documents")
        .select("parsed_data, status, file_type, storage_path")
        .eq("id", documentId)
        .single();

      if (doc?.parsed_data?.rowCount != null) {
        // Already parsed — use cached value (fast path)
        transactionCount = doc.parsed_data.rowCount;

      } else if (["xlsx", "csv", "xml"].includes(doc?.file_type ?? "")) {
        // Not yet ready — download and parse now (Vercel → Supabase)
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

    // ── LIVE 1C MODE ──────────────────────────────────────────────────────
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

    // ── Price & persist ───────────────────────────────────────────────────
    const { priceRub, tierName } = calcPrice(transactionCount, tiers);

    if (sessionId) {
      await supabase
        .from("audit_sessions")
        .update({
          transactions_ct: transactionCount,
          price_rub:       priceRub,
          tier_name:       tierName,
        })
        .eq("id", sessionId);
    }

    return NextResponse.json({ transactionCount, priceRub, tierName });

  } catch (err) {
    console.error("[calculate-price] error:", err);
    return NextResponse.json({ error: "Ошибка расчёта стоимости" }, { status: 500 });
  }
}
