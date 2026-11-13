/**
 * app/api/findings/decide/route.ts — the client's decision on a finding.
 *
 * POST { sessionId, findingId, decision: "confirm" | "decline" | "reopen", comment? }
 *   confirm — accept the agent's proposal: the finding becomes "resolved"
 *   decline — reject the proposal: the finding stays open
 *   reopen  — put a resolved finding back to open
 * GET  ?sessionId=…  -> { proposals: [...] } — proposals waiting for a decision
 *
 * Only a proposal recorded by the agent can be confirmed; the basis and the
 * documents come from that record, not from the request. The caller must be
 * signed in and own the audit (or be an admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { authorizeSession, isAccessError } from "@/lib/doc-billing-server";
import { decideFinding, findingsSchemaReady, loadAgentFindings, type Decision } from "@/lib/finding-updates-server";

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId");
    const supabase = createAdminClient();
    const access = await authorizeSession(supabase, sessionId);
    if (isAccessError(access)) return NextResponse.json({ error: access.error }, { status: access.status });
    if (!(await findingsSchemaReady(supabase))) return NextResponse.json({ proposals: [] });

    const codes = new Map((await loadAgentFindings(supabase, sessionId!)).map(f => [f.id, f.code]));
    const { data } = await supabase.from("findings")
      .select("id, title, risk_level, proposal_basis, proposal_documents, proposed_at")
      .eq("session_id", sessionId).eq("status", "open").not("proposed_at", "is", null)
      .order("proposed_at", { ascending: true });
    return NextResponse.json({
      proposals: (data ?? []).map(f => ({
        findingId: f.id, code: codes.get(f.id) ?? "", title: f.title, riskLevel: f.risk_level,
        basis: f.proposal_basis ?? "", documents: String(f.proposal_documents ?? "").split("; ").filter(Boolean),
      })),
    });
  } catch (err) {
    console.error("[findings] list error:", (err as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, findingId, decision, comment } = await req.json();
    if (typeof findingId !== "string" || !["confirm", "decline", "reopen"].includes(decision)) {
      return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
    }
    const supabase = createAdminClient();
    const access = await authorizeSession(supabase, sessionId);
    if (isAccessError(access)) return NextResponse.json({ error: access.error }, { status: access.status });
    if (!(await findingsSchemaReady(supabase))) {
      return NextResponse.json({ error: "Закрытие выводов ещё не настроено" }, { status: 409 });
    }

    const result = await decideFinding(supabase, sessionId, findingId, decision as Decision,
      { id: access.userId, role: access.isAdmin && access.session.client_id !== access.userId ? "admin" : "client" },
      typeof comment === "string" ? comment : undefined);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    console.log("[findings] decision —", decision, "| finding:", findingId, "| by:", access.isAdmin ? "admin" : "client");
    return NextResponse.json(result);
  } catch (err) {
    console.error("[findings] decide error:", (err as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
