/**
 * lib/finding-updates-server.ts — stage 2, server side: what the agent is
 * shown about the audit's findings, recording its proposals, and the
 * client's decision.
 */
import { createAdminClient } from "./supabase-server";
import { findingCode, describeRevision, type AgentFinding, type ValidUpdate, type Revision, type ResolutionKind } from "./finding-updates";

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

// Correcting an assessment needs migration 007. Without it the agent is not
// offered the "propose_revise" action and nothing else changes.
let revReady: boolean | null = null;
let revCheckedAt = 0;
export async function revisionSchemaReady(supabase: Admin): Promise<boolean> {
  if (revReady === true) return true;
  if (revReady === false && Date.now() - revCheckedAt < 60_000) return false;
  const { error } = await supabase.from("findings").select("revision_proposed_at").limit(1);
  revReady = !error;
  revCheckedAt = Date.now();
  if (error) console.warn("[findings] ⚠ migration 007_finding_revision.sql has NOT been run — the agent cannot propose corrected assessments.");
  return revReady;
}

// Report fields (financial impact, how a finding was closed) need migration 008.
let repReady: boolean | null = null;
let repCheckedAt = 0;
export async function reportFieldsReady(supabase: Admin): Promise<boolean> {
  if (repReady === true) return true;
  if (repReady === false && Date.now() - repCheckedAt < 60_000) return false;
  const { error } = await supabase.from("findings").select("financial_impact").limit(1);
  repReady = !error;
  repCheckedAt = Date.now();
  if (error) console.warn("[findings] ⚠ migration 008_finding_report_fields.sql has NOT been run — no financial impact, no corrected/documented mark.");
  return repReady;
}

/** Every finding of the audit, in order of creation, with its stable code. */
export async function loadAgentFindings(supabase: Admin, sessionId: string): Promise<AgentFinding[]> {
  const { data, error } = await supabase
    .from("findings")
    .select("*")
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
    legal_basis: f.legal_basis ?? null, financial_impact: f.financial_impact ?? null, revisionProposed: !!f.revision_proposed_at,
    risk_level: f.risk_level, evidence_status: f.evidence_status, status: f.status ?? "open",
    proposed: !!f.proposed_at, agent_note: f.agent_note,
    declined: f.status === "open" && !f.proposed_at ? declined.get(f.id) ?? null : null,
  }));
}

export interface Proposal { findingId: string; code: string; title: string; riskLevel: string; basis: string; documents: string[]; kind?: ResolutionKind | null }

/** A corrected assessment waiting for the client. */
export interface RevisionProposal {
  findingId: string; code: string; title: string;
  /** Current values, for the before → after view. */
  before: { risk_level: string; evidence_status: string | null; title: string; description: string; legal_basis: string | null; recommendation: string | null; financial_impact?: string | null };
  revision: Revision;
  summary: string;
  basis: string;
}

/**
 * Records what the agent concluded. Nothing here changes a finding's status:
 * "propose_close" only marks it as waiting for the client's decision.
 */
export async function applyAgentUpdates(
  supabase: Admin, sessionId: string, updates: ValidUpdate[], findings: AgentFinding[]
): Promise<{ proposals: Proposal[]; revisions: RevisionProposal[]; keptOpen: number }> {
  const proposals: Proposal[] = [];
  const revisions: RevisionProposal[] = [];
  let keptOpen = 0;
  const now = new Date().toISOString();
  for (const u of updates) {
    const f = findings.find(x => x.id === u.findingId)!;
    const documents = u.documents.join("; ");
    if (u.action === "propose_revise" && u.revision) {
      // Only recorded as a proposal — the finding itself is not touched.
      const { error } = await supabase.from("findings")
        .update({ revision_proposed_at: now, proposed_revision: u.revision, revision_basis: u.basis })
        .eq("id", u.findingId).eq("session_id", sessionId).eq("status", "open");
      if (error) { console.error("[findings] revision proposal error:", error.message); continue; }
      const summary = describeRevision(f, u.revision);
      revisions.push({
        findingId: f.id, code: f.code, title: f.title, summary, basis: u.basis, revision: u.revision,
        before: { risk_level: f.risk_level, evidence_status: f.evidence_status, title: f.title, description: f.description,
                  legal_basis: f.legal_basis ?? null, recommendation: f.recommendation, financial_impact: f.financial_impact ?? null },
      });
      await supabase.from("finding_events").insert({
        finding_id: u.findingId, session_id: sessionId, actor: "agent", event_type: "revision_proposed",
        note: u.basis, documents, payload: { revision: u.revision, summary },
      });
      continue;
    }
    if (u.action === "propose_close") {
      const { error } = await supabase.from("findings")
        .update({ proposed_at: now, proposal_basis: u.basis, proposal_documents: documents, agent_note: null,
                  ...(u.resolutionKind ? { proposal_kind: u.resolutionKind } : {}) })
        .eq("id", u.findingId).eq("session_id", sessionId).eq("status", "open");
      if (error) { console.error("[findings] proposal error:", error.message); continue; }
      proposals.push({ findingId: f.id, code: f.code, title: f.title, riskLevel: f.risk_level, basis: u.basis, documents: u.documents, kind: u.resolutionKind ?? null });
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
  return { proposals, revisions, keptOpen };
}

export type Decision = "confirm" | "decline" | "reopen" | "confirm_revision" | "decline_revision";

/** Corrections waiting for the client, with the current values for a before → after view. */
export async function loadRevisionProposals(supabase: Admin, sessionId: string): Promise<RevisionProposal[]> {
  if (!(await revisionSchemaReady(supabase))) return [];
  const all = await loadAgentFindings(supabase, sessionId);
  const { data } = await supabase.from("findings")
    .select("id, proposed_revision, revision_basis, revision_proposed_at")
    .eq("session_id", sessionId).eq("status", "open").not("revision_proposed_at", "is", null)
    .order("revision_proposed_at", { ascending: true });
  const out: RevisionProposal[] = [];
  for (const r of data ?? []) {
    const f = all.find(x => x.id === r.id);
    if (!f || !r.proposed_revision) continue;
    const revision = r.proposed_revision as Revision;
    out.push({
      findingId: f.id, code: f.code, title: f.title, revision, basis: r.revision_basis ?? "",
      summary: describeRevision(f, revision),
      before: { risk_level: f.risk_level, evidence_status: f.evidence_status, title: f.title, description: f.description,
                legal_basis: f.legal_basis ?? null, recommendation: f.recommendation, financial_impact: f.financial_impact ?? null },
    });
  }
  return out;
}

function appendRevisionLine(previous: string | null | undefined, summary: string, reason: string): string {
  const day = new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
  const line = `${day}: ${[summary, reason && `Причина: ${reason}`].filter(Boolean).join(". ")}`;
  const all = [String(previous ?? "").trim(), line].filter(Boolean).join("\n");
  return all.length > 4000 ? "…" + all.slice(all.length - 3999) : all;
}

/**
 * The client's decision on a proposed correction. On confirm the fields of
 * the stored proposal (never of the request) are written to the finding; the
 * previous values are kept in finding_events.payload.
 */
async function decideRevision(
  supabase: Admin, sessionId: string, findingId: string, confirm: boolean,
  actor: { id: string; role: "client" | "admin" }, note: string | null,
): Promise<{ ok: boolean; error?: string; status?: string }> {
  if (!(await revisionSchemaReady(supabase))) return { ok: false, error: "Исправление выводов ещё не настроено" };
  const { data: f } = await supabase.from("findings").select("*").eq("id", findingId).eq("session_id", sessionId).maybeSingle();
  if (!f) return { ok: false, error: "Вывод не найден" };
  if (!f.revision_proposed_at || !f.proposed_revision) return { ok: false, error: "По этому выводу нет предложения об исправлении" };
  const revision = f.proposed_revision as Revision;
  const clear = { revision_proposed_at: null, proposed_revision: null, revision_basis: null };

  if (!confirm) {
    await supabase.from("findings").update(clear).eq("id", findingId);
    await supabase.from("finding_events").insert({ finding_id: findingId, session_id: sessionId, actor: actor.role, actor_id: actor.id,
      event_type: "revision_declined", note, payload: { revision } });
    return { ok: true, status: f.status };
  }
  if (f.status !== "open") return { ok: false, error: "Вывод закрыт — исправлять нечего" };

  const before: Record<string, unknown> = {};
  for (const k of Object.keys(revision)) before[k] = f[k];
  const summary = describeRevision(f, revision);
  const reason = String(f.revision_basis ?? "").trim();
  const { data: moved } = await supabase.from("findings")
    // agent_note ("still open: …") was written against the old assessment and
    // may contradict the corrected one (Nov 13, Н-6: "обязанность возникнет при
    // возврате" left under the corrected finding) — it is cleared; the next
    // review writes a new one.
    // Each confirmed correction is a dated line of its own; a second one does
    // not hide the first (Nov 13, Н-6: the level change disappeared from the
    // page after a later correction of the description).
    .update({ ...revision, ...clear, agent_note: null, revised_at: new Date().toISOString(),
              revision_summary: appendRevisionLine(f.revision_summary, summary, reason) })
    .eq("id", findingId).eq("status", "open").not("revision_proposed_at", "is", null).select("id");
  if (!moved?.length) return { ok: false, error: "Состояние вывода изменилось — обновите страницу" };
  await supabase.from("finding_events").insert({ finding_id: findingId, session_id: sessionId, actor: actor.role, actor_id: actor.id,
    event_type: "revision_confirmed", note: note ?? reason, payload: { before, after: revision } });
  return { ok: true, status: "open" };
}

/**
 * The client's decision. Status changes are conditional on the current state,
 * so a repeated click or a stale screen cannot close or reopen anything twice.
 */
export async function decideFinding(
  supabase: Admin, sessionId: string, findingId: string, decision: Decision,
  actor: { id: string; role: "client" | "admin" }, comment?: string
): Promise<{ ok: boolean; error?: string; status?: string }> {
  if (decision === "confirm_revision" || decision === "decline_revision") {
    return decideRevision(supabase, sessionId, findingId, decision === "confirm_revision", actor,
      (comment ?? "").trim().slice(0, 1000) || null);
  }
  const { data: f } = await supabase.from("findings")
    .select("*")
    .eq("id", findingId).eq("session_id", sessionId).maybeSingle();
  const withKind = "proposal_kind" in (f ?? {});   // migration 008
  if (!f) return { ok: false, error: "Вывод не найден" };
  const now = new Date().toISOString();
  const note = (comment ?? "").trim().slice(0, 1000) || null;

  if (decision === "confirm") {
    if (f.status !== "open" || !f.proposed_at) return { ok: false, error: "По этому выводу нет предложения о закрытии" };
    const { data: moved } = await supabase.from("findings")
      .update({ status: "resolved", resolved_at: now, resolved_by: actor.id, resolution_basis: f.proposal_basis,
                resolution_documents: f.proposal_documents, proposed_at: null, agent_note: null,
                ...(withKind ? { resolution_kind: f.proposal_kind ?? null, proposal_kind: null } : {}) })
      .eq("id", findingId).eq("status", "open").not("proposed_at", "is", null).select("id");
    if (!moved?.length) return { ok: false, error: "Состояние вывода изменилось — обновите страницу" };
    await supabase.from("finding_events").insert({ finding_id: findingId, session_id: sessionId, actor: actor.role, actor_id: actor.id,
      event_type: "confirmed", note: note ?? f.proposal_basis, documents: f.proposal_documents });
    return { ok: true, status: "resolved" };
  }

  if (decision === "decline") {
    if (f.status !== "open" || !f.proposed_at) return { ok: false, error: "По этому выводу нет предложения о закрытии" };
    await supabase.from("findings")
      .update({ proposed_at: null, proposal_basis: null, proposal_documents: null, ...(withKind ? { proposal_kind: null } : {}) })
      .eq("id", findingId).eq("status", "open");
    await supabase.from("finding_events").insert({ finding_id: findingId, session_id: sessionId, actor: actor.role, actor_id: actor.id,
      event_type: "declined", note, documents: f.proposal_documents });
    return { ok: true, status: "open" };
  }

  if (f.status !== "resolved") return { ok: false, error: "Вывод не закрыт" };
  const { data: moved } = await supabase.from("findings")
    .update({ status: "open", resolved_at: null, resolved_by: null, resolution_basis: null, resolution_documents: null,
              ...(withKind ? { resolution_kind: null } : {}) })
    .eq("id", findingId).eq("status", "resolved").select("id");
  if (!moved?.length) return { ok: false, error: "Состояние вывода изменилось — обновите страницу" };
  await supabase.from("finding_events").insert({ finding_id: findingId, session_id: sessionId, actor: actor.role, actor_id: actor.id,
    event_type: "reopened", note });
  return { ok: true, status: "open" };
}
