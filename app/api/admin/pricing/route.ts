/**
 * app/api/admin/pricing/route.ts
 *
 * GET   -> returns the global rate (billing_settings row)
 * PATCH -> updates either the global rate or one client's override rate
 *          body: { scope: "global", price_per_transaction_rub } |
 *                { scope: "client", clientId, custom_price_rub: number|null }
 *
 * NOTE: still no admin-role check here -- same P0 gap as before
 * (see PUNCH_LIST.md). Add auth before this touches real client data.
 */

import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

// GET -- current global rate
export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("billing_settings")
    .select("price_per_transaction_rub, updated_at")
    .eq("id", 1)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PATCH -- update global rate or a client's override
export async function PATCH(req: NextRequest) {
  const supabase = createAdminClient();
  const body = await req.json();

  if (body.scope === "global") {
    const { price_per_transaction_rub } = body;
    if (!price_per_transaction_rub || price_per_transaction_rub <= 0) {
      return NextResponse.json({ error: "Некорректная ставка" }, { status: 400 });
    }

    const { error } = await supabase
      .from("billing_settings")
      .update({
        price_per_transaction_rub,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (body.scope === "client") {
    const { clientId, custom_price_rub } = body;
    if (!clientId) {
      return NextResponse.json({ error: "clientId обязателен" }, { status: 400 });
    }

    // One subscription row per client is assumed here. If a client has no
    // row yet, create one; otherwise update the most recent row.
    const { data: existing } = await supabase
      .from("client_subscriptions")
      .select("id")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("client_subscriptions")
        .update({
          custom_price_rub,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabase
        .from("client_subscriptions")
        .insert({ client_id: clientId, custom_price_rub });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown scope" }, { status: 400 });
}
