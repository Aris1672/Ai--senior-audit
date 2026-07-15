import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { LEGAL_FORM_VALUES, TAX_REGIME_VALUES, VAT_STATUS_VALUES } from "@/lib/audit-constants";

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
          supabase.from("audit_sessions").select("status, findings_ct, cost_rub, paid"),
          supabase.from("findings").select("risk_level"),
          supabase.from("usage_events").select("tokens_in, tokens_out, cost_rub"),
        ]);
        return NextResponse.json({ profiles, sessions, findings, usage });
      }

      // ── Admin clients list ─────────────────────────────────
      case "admin_clients": {
        const { data, error } = await supabase
          .from("profiles")
          .select(`
            id,
            full_name,
            company_name,
            inn,
            status,
            created_at,
            client_subscriptions (
              custom_price_rub,
              created_at
            ),
            audit_sessions (
              id,
              title,
              status,
              cost_rub,
              paid,
              created_at
            )
          `)
          .eq("role", "client")
          .neq("status", "deleted")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("admin_clients error:", error);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

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
          { data: settings },
        ] = await Promise.all([
          supabase.from("profiles").select("company_name").eq("id", clientId).single(),
          supabase.from("client_subscriptions")
            .select("custom_price_rub")
            .eq("client_id", clientId).order("created_at", { ascending: false }).limit(1),
          supabase.from("audit_sessions")
            .select("id, title, status, transactions_ct, findings_ct, cost_rub, paid, created_at")
            .eq("client_id", clientId).order("created_at", { ascending: false }).limit(5),
          supabase.from("findings")
            .select("id, risk_level, title, created_at")
            .eq("client_id", clientId).eq("status", "open")
            .order("created_at", { ascending: false }).limit(8),
          supabase.from("usage_events")
            .select("cost_rub, transactions_ct")
            .eq("client_id", clientId),
          supabase.from("billing_settings")
            .select("price_per_transaction_rub")
            .eq("id", 1).single(),
        ]);

        const effectiveRate = sub?.[0]?.custom_price_rub ?? settings?.price_per_transaction_rub ?? 0;

        return NextResponse.json({ profile, sub, sessions, findings, usage, effectiveRate });
      }
        // ── Admin: clients + their per-transaction rate override ──
      case "admin_client_rates": {
        const { data, error } = await supabase
          .from("profiles")
          .select(`
            id,
            company_name,
            client_subscriptions (
              custom_price_rub,
              created_at
            )
          `)
          .eq("role", "client")
          .neq("status", "deleted")
          .order("company_name");
 
        if (error) {
          console.error("admin_client_rates error:", error);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
 
        // Each client may have multiple subscription rows (historical);
        // take the most recent one's custom_price_rub, or null if none.
        const rows = (data || []).map((c: any) => {
          const subs = Array.isArray(c.client_subscriptions) ? c.client_subscriptions : [];
          const latest = subs.sort((a: any, b: any) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0];
          return {
            id:               c.id,
            company_name:     c.company_name || "(без названия)",
            custom_price_rub: latest?.custom_price_rub ?? null,
          };
        });
 
        return NextResponse.json(rows);
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
            .select("id, title, status, transactions_ct, findings_ct, cost_rub, paid, created_at")
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
      // NOTE (July 2026): this path creates a session with NO tax-profile
      // fields (legal_form/tax_regime/vat_status all null) — it bypasses
      // the gate enforced in create_audit_session below entirely. Left
      // unchanged here because the caller (likely app/client/chat/page.tsx)
      // hasn't been reviewed yet. confirm_audit's defense-in-depth check
      // will still block a session created this way from ever reaching
      // full analysis, but this path can currently produce an orphaned
      // "active" session with no way to complete it — worth fixing once
      // the calling page is in hand. See PROJECT_STATUS.md.
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
        const {
          clientId, companyName, inn, period, sourceType,
          legalForm, legalFormOther, taxRegime, taxRegimeOther, vatStatus,
        } = payload;

        // ── Tax-profile gate — server-side validation, never trust the
        //    dropdown alone (this is the actual enforcement point; the
        //    wizard's client-side check is just UX, not security/correctness).
        //    Added July 2026 — see PROJECT_STATUS.md Session Log for why:
        //    identical input data was producing different risk-tier
        //    conclusions across separate AI runs, traced partly to the
        //    model guessing at (or inconsistently asking about) tax regime.
        if (!legalForm || !LEGAL_FORM_VALUES.has(legalForm)) {
          return NextResponse.json({ error: "Не указана организационно-правовая форма" }, { status: 400 });
        }
        if (legalForm === "Другое" && !legalFormOther?.trim()) {
          return NextResponse.json({ error: 'Укажите организационно-правовую форму в поле "Другое"' }, { status: 400 });
        }
        if (!taxRegime || !TAX_REGIME_VALUES.has(taxRegime)) {
          return NextResponse.json({ error: "Не указана система налогообложения" }, { status: 400 });
        }
        if (taxRegime === "Другое" && !taxRegimeOther?.trim()) {
          return NextResponse.json({ error: 'Укажите систему налогообложения в поле "Другое"' }, { status: 400 });
        }
        if (!vatStatus || !VAT_STATUS_VALUES.has(vatStatus)) {
          return NextResponse.json({ error: "Не указан статус НДС" }, { status: 400 });
        }

        const { data: session } = await supabase
          .from("audit_sessions")
          .insert({
            client_id:         clientId,
            title:             `Аудит: ${companyName}${period ? ` (${period})` : ""}`,
            status:            "active",
            legal_form:        legalForm,
            legal_form_other:  legalForm === "Другое" ? legalFormOther.trim() : null,
            tax_regime:        taxRegime,
            tax_regime_other:  taxRegime === "Другое" ? taxRegimeOther.trim() : null,
            vat_status:        vatStatus,
          })
          .select().single();
        return NextResponse.json({ sessionId: session?.id });
      }

      // ── Confirm audit — save final price ──────────────────
      case "confirm_audit": {
        const { sessionId, priceRub, transactionCount } = payload;

        // ── Defense-in-depth: re-check the tax-profile gate against the
        //    DB row itself, not just at creation time. Catches any session
        //    that reached this point without going through
        //    create_audit_session's validation above — e.g. via
        //    get_or_create_session (see note on that action above), or a
        //    direct API call bypassing the wizard entirely.
        const { data: existingSession } = await supabase
          .from("audit_sessions")
          .select("legal_form, tax_regime, vat_status")
          .eq("id", sessionId)
          .single();

        if (!existingSession?.legal_form || !existingSession?.tax_regime || !existingSession?.vat_status) {
          return NextResponse.json(
            {
              error:
                "Для этой сессии не заполнен налоговый профиль (организационно-правовая форма, система налогообложения, статус НДС). Начните аудит заново через мастер создания.",
            },
            { status: 400 }
          );
        }

        await supabase.from("audit_sessions").update({
          cost_rub:        priceRub,
          transactions_ct: transactionCount ?? 0,
        }).eq("id", sessionId);
        return NextResponse.json({ success: true });
      }

      // ── Get session context for chat ───────────────────────
      case "get_session_context": {
        const { sessionId } = payload;
        const { data } = await supabase
          .from("audit_sessions")
          .select(`
            id, title, status, transactions_ct, cost_rub, period_from, period_to,
            legal_form, legal_form_other, tax_regime, tax_regime_other, vat_status
          `)
          .eq("id", sessionId)
          .single();

        if (!data) return NextResponse.json({});

        const title = data.title || "";
        const companyMatch = title.match(/Аудит:\s*(.+?)(?:\s*\(|$)/);
        const periodMatch  = title.match(/\((.+?)\)/);

        return NextResponse.json({
          ...data,
          company_name: companyMatch?.[1]?.trim() || title,
          period:       periodMatch?.[1]?.trim()  || "",
          source_type:  "file",
          // Resolved single-value display strings — "Другое" swapped for
          // the free-text value the client actually entered, so anything
          // consuming this response (AI context builder, UI) never has to
          // special-case "Другое" itself.
          legal_form_display: data.legal_form === "Другое" ? data.legal_form_other : data.legal_form,
          tax_regime_display: data.tax_regime === "Другое" ? data.tax_regime_other : data.tax_regime,
        });
      }

      // ── Delete client ──────────────────────────────────────
      case "delete_client": {
        const { clientId } = payload;
        await supabase.from("profiles")
          .update({ status: "deleted", updated_at: new Date().toISOString() })
          .eq("id", clientId);
        return NextResponse.json({ success: true });
      }

      // ── Check if client has any audit sessions ─────────────
      case "get_client_sessions": {
        const { clientId, limit = 1 } = payload;
        const { data } = await supabase
          .from("audit_sessions")
          .select("id, title, status, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(limit);
        return NextResponse.json(data || []);
      }

      // ── Update session status ──────────────────────────────
      case "update_session_status": {
        const { sessionId, status } = payload;
        await supabase
          .from("audit_sessions")
          .update({ status })
          .eq("id", sessionId);
        return NextResponse.json({ success: true });
      }

      case "update_session_paid": {
        const { sessionId, paid } = payload;
        await supabase
          .from("audit_sessions")
          .update({ paid })
          .eq("id", sessionId);
        return NextResponse.json({ success: true });
      }

      // ── Audit detail page ──────────────────────────────────
      case "audit_detail": {
        const { sessionId } = payload;
        const [
          { data: sessionRaw },
          { data: findings },
          { data: messages },
        ] = await Promise.all([
          supabase
            .from("audit_sessions")
            .select(`
              id, title, status, transactions_ct, findings_ct, cost_rub, created_at,
              legal_form, legal_form_other, tax_regime, tax_regime_other, vat_status
            `)
            .eq("id", sessionId)
            .single(),
          supabase
            .from("findings")
            .select("id, risk_level, title, description, legal_basis, recommendation, status, created_at")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true }),
          supabase
            .from("audit_messages")
            .select("role, content")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true }),
        ]);

        if (!sessionRaw) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const title        = sessionRaw.title || "";
        const companyMatch = title.match(/Аудит:\s*(.+?)(?:\s*\(|$)/);
        const periodMatch  = title.match(/\((.+?)\)/);

        const session = {
          ...sessionRaw,
          company_name: companyMatch?.[1]?.trim() || title,
          period:       periodMatch?.[1]?.trim()  || "",
          legal_form_display: sessionRaw.legal_form === "Другое" ? sessionRaw.legal_form_other : sessionRaw.legal_form,
          tax_regime_display: sessionRaw.tax_regime === "Другое" ? sessionRaw.tax_regime_other : sessionRaw.tax_regime,
        };

        return NextResponse.json({
          session,
          findings: findings || [],
          messages: messages || [],
        });
      }

      // ── generate_report removed — PDF is now generated
      //    client-side in page.tsx using pdfmake in the browser.
      //    All required data (session, findings) is already in
      //    React state, so no server round-trip is needed.

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("data route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
