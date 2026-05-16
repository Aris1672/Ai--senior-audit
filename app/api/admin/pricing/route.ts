import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

// GET — list all tiers including inactive
export async function GET() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("pricing_tiers")
    .select("*")
    .order("sort_order");
  return NextResponse.json(data || []);
}

// POST — create new tier
export async function POST(req: NextRequest) {
  const supabase = createAdminClient();
  const { name, max_transactions, price_rub, description } = await req.json();

  // Set sort_order as max + 1
  const { data: existing } = await supabase
    .from("pricing_tiers")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order || 0) + 1;

  const { error } = await supabase.from("pricing_tiers").insert({
    name, max_transactions, price_rub,
    description: description || `До ${max_transactions.toLocaleString("ru")} транзакций на 1 аудит`,
    sort_order: nextOrder,
    is_active: true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// PATCH — update tier
export async function PATCH(req: NextRequest) {
  const supabase = createAdminClient();
  const { tierId, ...updates } = await req.json();

  const { error } = await supabase
    .from("pricing_tiers")
    .update(updates)
    .eq("id", tierId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE — remove tier
export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient();
  const { tierId } = await req.json();

  const { error } = await supabase
    .from("pricing_tiers")
    .delete()
    .eq("id", tierId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}