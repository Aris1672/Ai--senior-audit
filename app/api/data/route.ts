import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { action, payload } = await req.json();
    const supabase = createAdminClient();

    switch (action) {

      // ── Admin dashboard stats ──────────────────────────────
      case "admin_stats": {
        const [
          { data: profiles },
          { data: sessions },
          { data: findings },
          { data: usage },
        ] = await Promise.all([
          supabase.from("profiles").select("status").eq("role", "client").neq("status", "deleted"),
          supabase.from("audit_sessions").select("status, findings_ct, cost_rub"),
          supabase.from("findings").select("risk_level"),
          supabase.from("usage_events").select("tokens_in, tokens_out, cost_rub"),
        ]);
        return NextResponse.json({ profiles, sessions, findings, usage });
      }

      // ── Admin clients list ─────────────────────────────────
      case "admin_clients": {
        const { data } = await supabase
          .from("profiles")
          .select(`
            id, full_name, company_name, inn, status, created_at,
            client_subscriptions (
              audits_purchased, audits_used, custom_price_rub,
              pricing_tiers ( name, price_rub )
            ),
            audit_sessions ( id, status, cost_rub )
          `)
          .eq("role", "client")
          .neq("status", "deleted")
          .order("created_at", { ascending: false });
        return NextResponse.json(data || []);
      }

      // ── Pricing tiers ──────────────────────────────────────
      case "pricing_tiers": {
        const { data } = await supabase
          .from("pricing_tiers")
          .select("*")
          .eq("is_active", true)
          .order("sort_order");
        return NextResponse.json(data || []);
      }
      // ── All pricing tiers including inactive (admin only) ──
      case "pricing_tiers_all": {
        const { data } = await supabase
         .from("pricing_tiers")
         .select("*")
         .order("sort_order");
      return NextResponse.json(data || []);
      }
      // ── Client dashboard data ──────────────────────────────
      case "client_dashboard": {
        const { clientId } = payload;
        const [
          { data: profile },
          { data: sub },
          { data: sessions },
          { data: findings },
          { data: usage },
        ] = await Promise.all([
          supabase.from("profiles").select("company_name").eq("id", clientId).single(),
          supabase.from("client_subscriptions")
            .select("audits_purchased, audits_used, custom_price_rub, custom_max_tx, pricing_tiers(name, price_rub, max_transactions)")
            .eq("client_id", clientId).order("created_at", { ascending: false }).limit(1),
          supabase.from("audit_sessions")
            .select("id, title, status, transactions_ct, findings_ct, cost_rub, created_at")
            .eq("client_id", clientId).order("created_at", { ascending: false }).limit(5),
          supabase.from("findings")
            .select("id, risk_level, title, created_at")
            .eq("client_id", clientId).eq("status", "open")
            .order("created_at", { ascending: false }).limit(8),
          supabase.from("usage_events")
            .select("cost_rub, transactions_ct")
            .eq("client_id", clientId),
        ]);
        return NextResponse.json({ profile, sub, sessions, findings, usage });
      }

      // ── Client usage events ────────────────────────────────
      case "client_usage": {
        const { clientId } = payload;
        const { data } = await supabase
          .from("usage_events")
          .select("*")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(100);
        return NextResponse.json(data || []);
      }

      // ── Client documents ───────────────────────────────────
      case "client_documents": {
        const { clientId } = payload;
        const { data } = await supabase
          .from("documents")
          .select("id, file_name, file_type, file_size, status, uploaded_at")
          .eq("client_id", clientId)
          .order("uploaded_at", { ascending: false });
        return NextResponse.json(data || []);
      }

      // ── Client messages ────────────────────────────────────
      case "client_messages": {
        const { sessionId } = payload;
        const { data } = await supabase
          .from("audit_messages")
          .select("role, content")
          .eq("session_id", sessionId)
          .order("created_at");
        return NextResponse.json(data || []);
      }

      // ── Get or create active session ───────────────────────
      case "get_or_create_session": {
        const { clientId } = payload;
        const { data: existing } = await supabase
          .from("audit_sessions")
          .select("id")
          .eq("client_id", clientId)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1);

        if (existing && existing.length > 0) {
          return NextResponse.json({ sessionId: existing[0].id, isNew: false });
        }

        const { data: newSession } = await supabase
          .from("audit_sessions")
          .insert({
            client_id: clientId,
            title: `Аудит ${new Date().toLocaleDateString("ru")}`,
            status: "active",
          })
          .select().single();

        return NextResponse.json({ sessionId: newSession?.id, isNew: true });
      }

      // ── Save message ───────────────────────────────────────
      case "save_message": {
        const { sessionId, clientId, role, content } = payload;
        await supabase.from("audit_messages").insert({
          session_id: sessionId, client_id: clientId, role, content,
        });
        return NextResponse.json({ success: true });
      }

      // ── Update client status ───────────────────────────────
      case "update_client_status": {
        const { clientId, status } = payload;
        await supabase.from("profiles")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", clientId);
        return NextResponse.json({ success: true });
      }
      // ── Create new audit session ───────────────────────────
case "create_audit_session": {
  const { clientId, companyName, inn, period, sourceType } = payload;
  const { data: session } = await supabase
    .from("audit_sessions")
    .insert({
      client_id: clientId,
      title:     `Аудит: ${companyName}${period ? ` (${period})` : ""}`,
      status:    "active",
    })
    .select().single();
  return NextResponse.json({ sessionId: session?.id });
}

// ── Confirm audit — save final price ──────────────────
case "confirm_audit": {
  const { sessionId, priceRub } = payload;
  await supabase.from("audit_sessions").update({
    cost_rub: priceRub,
  }).eq("id", sessionId);
  return NextResponse.json({ success: true });
}

      // ── Delete client ──────────────────────────────────────
      case "delete_client": {
        const { clientId } = payload;
        await supabase.from("profiles")
          .update({ status: "deleted", updated_at: new Date().toISOString() })
          .eq("id", clientId);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("data route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}