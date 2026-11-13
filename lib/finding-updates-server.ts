/**
 * lib/finding-updates-server.ts — stage 2, server side: what the agent is
 * shown about the audit's findings, recording its proposals, and the
 * client's decision.
 */
import { createAdminClient } from "./supabase-server";
import { findingCode, type AgentFinding, type ValidUpdate } from "./finding-updates";

type Admin = ReturnType<typeof createAdminClient>;

// The columns come from migration 006. Until it has been run, stage 2 is
// simply absent: the agent is shown no findings and gets no second tool.
let ready: boolean | null = null;
let checkedAt = 0;
export async function findingsSchemaReady(supabase: Admin): Promise<boolean> {
  if (ready === true) return true;
  if (ready === false && Date.now() - checkedAt < 60_000) return false;
  const { error } = await supabase.from("findings").select("proposed_at").limit(1);
  ready = !error;
  checkedAt = Date.now();
  if (error) console.warn("[findings] ⚠ migration 006_finding_resolution.sql has NOT been run — findings cannot be closed (stage 2 is off).");
  return ready;
}

/** Every finding of the audit, in order of creation, with its stable code. */
export async function loadAgentFindings(supabase: Admin, sessionId: string): Promise<AgentFinding[]> {
  const { data, error } = await supabase
    .from("findings")
    .select("id, title, description, recommendation, risk_level, evidence_status, status, proposed_at, agent_note, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) { console.error("[findings] load error:", error.message); return []; }

  // Was the agent's last proposal declined by the client? (history: finding_events)
  const declined = new Map<string, { at: string; basis: string }>();
  const { data: events } = await supabase.from("finding_events")
    .select("finding_id, event_type, note, created_at")
    .eq("session_id", sessionId).in("event_type", ["proposed", "declined", "confirmed", "reopened"])
    .order("created_at", { ascending: true });
  const lastBasis = new Map<string, string>();
  for (const e of events ?? []) {
    if (e.event_type === "proposed") { lastBasis.set(e.finding_id, e.note ?? ""); declined.delete(e.finding_id); }
    else if (e.event_type === "declined") {
      declined.set(e.finding_id, {
        at: new Date(e.created_at).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }),
        basis: lastBasis.get(e.finding_id) ?? "",
      });
    } else declined.delete(e.finding_id);
  }

  return (data ?? []).map((f, i) => ({
    id: f.id, code: findingCode(i), title: f.title, description: f.description, recommendation: f.recommendation,
    risk_level: f.risk_level, evidence_status: f.evidence_status, status: f.status ?? "open",
    proposed: !!f.proposed_at, agent_note: f.agent_note,
    declined: f.status === "open" && !f.proposed_at ? declined.get(f.id) ?? null : null,
  }));
}

export interface Proposal { findingId: string; code: string; title: string; riskLevel: string; basis: string; documents: string[] }

/**
 * Records what the agent concluded. Nothing here changes a finding's status:
 * "propose_close" only marks it as waiting for the client's decision.
 */
export async function applyAgentUpdates(
  supabase: Admin, sessionId: string, updates: ValidUpdate[], findings: AgentFinding[]
): Promise<{ proposals: Proposal[]; keptOpen: number }> {
  const proposals: Proposal[] = [];
  let keptOpen = 0;
  const now = new Date().toISOString();
  for (const u of updates) {
    const f = findings.find(x => x.id === u.findingId)!;
    const documents = u.documents.join("; ");
    if (u.action === "propose_close") {
      const { error } = await supabase.from("findings")
        .update({ proposed_at: now, proposal_basis: u.basis, proposal_documents: documents, agent_note: null })
        .eq("id", u.findingId).eq("session_id", sessionId).eq("status", "open");
      if (error) { console.error("[findings] proposal error:", error.message); continue; }
      proposals.push({ findingId: f.id, code: f.code, title: f.title, riskLevel: f.risk_level, basis: u.basis, documents: u.documents });
    } else {
      // A new "still open" verdict withdraws an earlier proposal: the agent has changed its view.
      const note = [u.basis, u.remaining && `Что нужно: ${u.remaining}`].filter(Boolean).join(" ");
      const { error } = await supabase.from("findings")
        .update({ agent_note: note, proposed_at: null, proposal_basis: null, proposal_documents: null })
        .eq("id", u.findingId).eq("session_id", sessionId).eq("status", "open");
      if (error) { console.error("[findings] note error:", error.message); continue; }
      keptOpen++;
    }
    await supabase.from("finding_events").insert({
      finding_id: u.findingId, session_id: sessionId, actor: "agent",
      event_type: u.action === "propose_close" ? "proposed" : "kept_open",
      note: u.action === "propose_close" ? u.basis : [u.basis, u.remaining && `Что нужно: ${u.remaining}`].filter(Boolean).join(" "),
      documents,
    });
  }
  return { proposals, keptOpen };
}

export type Decision = "confirm" | "decline" | "reopen";

/**
 * The client's decision. Status changes are conditional on the current state,
 * so a repeated click or a stale screen cannot close or reopen anything twice.
 */
export async function decideFinding(
  supabase: Admin, sessionId: string, findingId: string, decision: Decision,
  actor: { id: string; role: "client" | "admin" }, comment?: string
): Promise<{ ok: boolean; error?: string; status?: string }> {
  const { data: f } = await supabase.from("findings")
    .select("id, status, proposed_at, proposal_basis, proposal_documents")
    .eq("id", findingId).eq("session_id", sessionId).maybeSingle();
  if (!f) return { ok: false, error: "Вывод не найден" };
  const now = new Date().toISOString();
  const note = (comment ?? "").trim().slice(0, 1000) || null;

  if (decision === "confirm") {
    if (f.status !== "open" || !f.proposed_at) return { ok: false, error: "По этому выводу нет предложения о закрытии" };
    const { data: moved } = await supabase.from("findings")
      .update({ status: "resolved", resolved_at: now, resolved_by: actor.id, resolution_basis: f.proposal_basis,
                resolution_documents: f.proposal_documents, proposed_at: null, agent_note: null })
      .eq("id", findingId).eq("status", "open").not("proposed_at", "is", null).select("id");
    if (!moved?.length) return { ok: false, error: "Состояние вывода изменилось — обновите страницу" };
    await supabase.from("finding_events").insert({ finding_id: findingId, session_id: sessionId, actor: actor.role, actor_id: actor.id,
      event_type: "confirmed", note: note ?? f.proposal_basis, documents: f.proposal_documents });
    return { ok: true, status: "resolved" };
  }

  if (decision === "decline") {
    if (f.status !== "open" || !f.proposed_at) return { ok: false, error: "По этому выводу нет предложения о закрытии" };
    await supabase.from("findings")
      .update({ proposed_at: null, proposal_basis: null, proposal_documents: null })
      .eq("id", findingId).eq("status", "open");
    await supabase.from("finding_events").insert({ finding_id: findingId, session_id: sessionId, actor: actor.role, actor_id: actor.id,
      event_type: "declined", note, documents: f.proposal_documents });
    return { ok: true, status: "open" };
  }

  if (f.status !== "resolved") return { ok: false, error: "Вывод не закрыт" };
  const { data: moved } = await supabase.from("findings")
    .update({ status: "open", resolved_at: null, resolved_by: null, resolution_basis: null, resolution_documents: null })
    .eq("id", findingId).eq("status", "resolved").select("id");
  if (!moved?.length) return { ok: false, error: "Состояние вывода изменилось — обновите страницу" };
  await supabase.from("finding_events").insert({ finding_id: findingId, session_id: sessionId, actor: actor.role, actor_id: actor.id,
    event_type: "reopened", note });
  return { ok: true, status: "open" };
}
