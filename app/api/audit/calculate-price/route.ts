import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

// Determine price tier based on transaction count
function calcPrice(txCount: number, tiers: any[]): { priceRub: number; tierName: string } {
  // Sort tiers by max_transactions ascending
  const sorted = [...tiers].sort((a, b) => a.max_transactions - b.max_transactions);

  for (const tier of sorted) {
    if (txCount <= tier.max_transactions) {
      return { priceRub: tier.price_rub, tierName: tier.name };
    }
  }

  // Above all tiers — use highest tier
  const highest = sorted[sorted.length - 1];
  return { priceRub: highest.price_rub, tierName: `${highest.name} (превышен лимит)` };
}

export async function POST(req: NextRequest) {
  try {
    const { documentId, sessionId, clientId, c1Config } = await req.json();
    const supabase = createAdminClient();

    // Get active pricing tiers
    const { data: tiers } = await supabase
      .from("pricing_tiers")
      .select("*")
      .eq("is_active", true);

    if (!tiers || tiers.length === 0) {
      return NextResponse.json(
        { error: "Тарифы не настроены. Обратитесь к администратору." },
        { status: 500 }
      );
    }

    let transactionCount = 0;

    if (documentId) {
      // ── FILE MODE: count rows from parsed document ──────────────────
      const { data: doc } = await supabase
        .from("documents")
        .select("parsed_data, file_type, storage_path")
        .eq("id", documentId)
        .single();

      if (doc?.parsed_data?.rowCount) {
        transactionCount = doc.parsed_data.rowCount;
      } else {
        // Parse the file to count rows
        const { data: fileData } = await supabase.storage
          .from("audit-documents")
          .download(doc?.storage_path || "");

        if (fileData) {
          const text = await fileData.text();

          if (doc?.file_type === "csv") {
            // Count CSV rows (subtract header)
            const lines = text.split("\n").filter(l => l.trim());
            transactionCount = Math.max(0, lines.length - 1);

          } else if (doc?.file_type === "xml") {
            // Count XML transaction elements
            const matches = text.match(/<(Документ|Document|ХозяйственнаяОперация|transaction)/gi);
            transactionCount = matches?.length || 0;

          } else {
            // For xlsx — use a reasonable estimate based on file size
            // Real xlsx parsing would need a worker, this is a fallback
            transactionCount = Math.floor((fileData.size || 0) / 200);
          }

          // Update document with parsed row count
          await supabase.from("documents").update({
            parsed_data: { rowCount: transactionCount },
            status: "ready",
          }).eq("id", documentId);
        }
      }

    } else if (c1Config) {
      // ── LIVE 1C MODE: query OData for transaction count ─────────────
      const { url, username, password, base } = c1Config;
      const baseUrl = `${url}/${base}/odata/standard.odata`;
      const auth    = Buffer.from(`${username}:${password}`).toString("base64");

      try {
        const c1Res = await fetch(
          `${baseUrl}/Document_ПоступлениеТоваровУслуг?$count=true&$top=0&$format=json`,
          {
            headers: { Authorization: `Basic ${auth}` },
            signal: AbortSignal.timeout(10000), // 10s timeout
          }
        );

        if (!c1Res.ok) {
          return NextResponse.json(
            { error: "Не удалось подключиться к 1С. Проверьте настройки подключения." },
            { status: 400 }
          );
        }

        const c1Data = await c1Res.json();
        transactionCount = c1Data["@odata.count"] || 0;

      } catch (err) {
        return NextResponse.json(
          { error: "Превышено время ожидания подключения к 1С. Проверьте доступность сервера." },
          { status: 400 }
        );
      }
    }

    // Calculate price
    const { priceRub, tierName } = calcPrice(transactionCount, tiers);

    // Update session with transaction count
    await supabase.from("audit_sessions").update({
      transactions_ct: transactionCount,
    }).eq("id", sessionId);

    return NextResponse.json({ transactionCount, priceRub, tierName });

  } catch (err) {
    console.error("calculate-price error:", err);
    return NextResponse.json({ error: "Ошибка расчёта стоимости" }, { status: 500 });
  }
}