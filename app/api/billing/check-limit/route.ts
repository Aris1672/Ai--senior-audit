import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { clientId, transactionCount } = await req.json();

    if (!clientId) {
      return NextResponse.json(
        { allowed: false, reason: "clientId обязателен" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Check client status first
    const { data: profile } = await supabase
      .from("profiles")
      .select("status, company_name")
      .eq("id", clientId)
      .single();

    if (!profile) {
      return NextResponse.json(
        { allowed: false, reason: "Клиент не найден" },
        { status: 404 }
      );
    }

    if (profile.status === "paused") {
      return NextResponse.json(
        { allowed: false, reason: "Аккаунт приостановлен. Обратитесь к администратору." },
        { status: 403 }
      );
    }

    if (profile.status === "deleted") {
      return NextResponse.json(
        { allowed: false, reason: "Аккаунт удалён." },
        { status: 403 }
      );
    }

    // Get effective tier limits
    const { data, error } = await supabase
      .rpc("get_client_limit", { p_client_id: clientId });

    if (error || !data || data.length === 0) {
      return NextResponse.json(
        { allowed: false, reason: "Нет активной подписки. Обратитесь к администратору." },
        { status: 403 }
      );
    }

    const { max_tx, price_rub, audits_remaining } = data[0];

    if (audits_remaining <= 0) {
      return NextResponse.json(
        {
          allowed:      false,
          reason:       "Все оплаченные аудиты использованы. Приобретите новый пакет.",
          upgrade_hint: true,
        },
        { status: 403 }
      );
    }

    if (transactionCount > max_tx) {
      return NextResponse.json(
        {
          allowed:      false,
          reason:       `Превышен лимит тарифа: ${transactionCount} транзакций, лимит ${max_tx}.`,
          upgrade_hint: true,
          current_tx:   transactionCount,
          max_tx,
        },
        { status: 403 }
      );
    }

    const percentUsed = Math.round((transactionCount / max_tx) * 100);

    return NextResponse.json({
      allowed:           true,
      max_tx,
      price_rub,
      audits_remaining,
      percent_used:      percentUsed,
      transactions_left: max_tx - transactionCount,
    });

  } catch (err) {
    console.error("check-limit error:", err);
    return NextResponse.json(
      { allowed: false, reason: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}