/**
 * lib/audit-engine.ts — one audit turn: draft pass + quality-review pass.
 *
 * Shared by /api/chat (production) and scripts/check-audit.ts (regression
 * test) so the test always measures exactly what clients get.
 *
 * Why two passes (Nov 12, 2026 — user decision: quality over time):
 * the same model on the same file gave 3, 5 or 6 findings across runs and
 * sometimes flagged an item it had itself reconciled. So a full report is
 * now produced in two steps:
 *   1. DRAFT  — the audit as before (report text + record_findings). The
 *      client does NOT get this as the answer; it goes to the "thinking"
 *      panel so the work stays visible.
 *   2. REVIEW — a fresh call (it sees the draft only as text, not the first
 *      pass's reasoning) acts as a reviewing auditor: re-checks every draft
 *      finding against the data, looks for what was missed, then writes the
 *      FINAL report and makes the only record_findings call that is saved.
 * Final text and saved findings therefore still come from one call.
 *
 * Short replies (the audit-purpose question, follow-up answers) are not
 * reviewed — only a full report is (record_findings called, or the text
 * has report structure). If the review fails or comes back incomplete, the
 * draft is delivered instead and the result says so (reviewed: "failed").
 */
import type Anthropic from "@anthropic-ai/sdk";
import {
  llm, AUDIT_MODEL, FINDINGS_TOOL, LLM_EXTRA_PARAMS, AUDIT_MAX_OUTPUT_TOKENS,
  LLM_THINKING_ENABLED, AUDIT_REVIEW_ENABLED, buildReviewRequest, AUDIT_SYSTEM_PROMPT,
} from "./llm";
import { Pseudonymizer, PseudonymizationError, PSEUDONYM_NOTE } from "./pseudonymize";
import { detectNames } from "./ner-client";

type Msg = Anthropic.Messages.MessageParam;

export interface AuditCallbacks {
  step:     (text: string) => void;   // a real pipeline step (checklist line)
  thinking: (delta: string) => void;  // model reasoning / draft text (work panel)
  text:     (delta: string) => void;  // text of the answer shown to the client
  reset:    () => void;               // discard answer text sent so far
}

/** Extra tools for one turn (stage 2: `update_findings`). */
export interface TurnOptions { extraTools?: Anthropic.Messages.Tool[] }

export interface PassResult {
  text: string;
  findings: unknown[];
  /** Entries of every `update_findings` call (stage 2) — proposals about EXISTING findings. */
  updates: unknown[];
  toolCalled: boolean;
  stopReason: string | null;
  tokensIn: number;
  tokensOut: number;
}

export interface AuditTurnResult {
  text: string;               // final answer text (authoritative)
  findings: unknown[];        // final findings to validate + save
  updates: unknown[];         // proposals about existing findings (stage 2), to validate + apply
  reviewed: "done" | "skipped" | "failed";
  draft?: PassResult;         // present when a review was attempted
  tokensIn: number;
  tokensOut: number;
}

const MAX_CONTINUATIONS = 5; // hard safety limit on auto-continue loops
const MAX_TOOL_RESUMES = 2;  // finishing the text after a tool call (see runPass)

/** True when the reply is empty or stops mid-sentence (no closing punctuation). */
export function looksUnfinished(text: string): boolean {
  const t = text.replace(/[\s*_`]+$/u, "");
  if (!t) return true;
  return !/[.!?…:;»")\]|]$/u.test(t);
}
const GATE_CHARS = 400;      // how much of pass 1 to hold before deciding draft vs direct answer

function looksLikeReport(text: string): boolean {
  // «Резюме аудитора» is the mandatory first section of every full report.
  // Deliberately NOT "any markdown heading": a follow-up answer with headings
  // must stay a direct answer, not be turned into a reviewed full report.
  return /резюме аудитора/i.test(text);
}

// ── One model pass: streaming, record_findings capture, auto-continue ────────
async function runPass(
  system: string,
  messages: Msg[],
  on: { text: (d: string) => void; thinking: (d: string) => void; continuing: () => void },
  label: string,
  extraTools: Anthropic.Messages.Tool[] = [],
): Promise<PassResult> {
  let fullText = "";
  let working = [...messages];
  let continuations = 0;
  let stopReason: string | null = null;
  let findings: unknown[] = [];
  const updates: unknown[] = [];
  let toolCalled = false;
  let tokensIn = 0, tokensOut = 0;
  let toolResumes = 0;
  let resumeAfterTool = false;

  do {
    let chunk = "";
    const stream = llm.messages.stream({
      model:       AUDIT_MODEL,
      max_tokens:  AUDIT_MAX_OUTPUT_TOKENS,
      system,
      messages:    working,
      tools:       [FINDINGS_TOOL, ...extraTools],
      tool_choice: { type: "auto" }, // must stay "auto": type "tool" returns 400 in DeepSeek thinking mode
      ...LLM_EXTRA_PARAMS,
    });
    stream.on("thinking", (d: string) => on.thinking(d));
    stream.on("text", (d: string) => { chunk += d; fullText += d; on.text(d); });

    const final = await stream.finalMessage();

    // record_findings must fire at most once per pass, even across
    // max_tokens continuations — a second call is ignored.
    for (const block of final.content) {
      if (block.type === "tool_use" && block.name === "update_findings") {
        const input = block.input as { updates?: unknown[] };
        if (Array.isArray(input?.updates)) updates.push(...input.updates);
        continue;
      }
      if (block.type === "tool_use" && block.name === "record_findings") {
        if (toolCalled) {
          console.warn(`[audit:${label}] record_findings called again in the same pass — ignored`);
          continue;
        }
        const input = block.input as { findings?: unknown[] };
        if (Array.isArray(input?.findings)) { findings = input.findings; toolCalled = true; }
      }
    }

    stopReason = final.stop_reason;
    // DeepSeek: total input = input_tokens + cache read + cache creation.
    const u = final.usage as { input_tokens?: number; output_tokens?: number;
      cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
    tokensIn  += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    tokensOut += u.output_tokens ?? 0;

    console.log(`[audit:${label}] stop_reason: ${stopReason} | chunk: ${chunk.length} | total: ${fullText.length} | findings: ${findings.length}`);

    if (stopReason === "max_tokens" && continuations < MAX_CONTINUATIONS) {
      // With thinking enabled (DeepSeek) the assistant's full content must be
      // passed back, thinking blocks included. tool_use blocks are dropped:
      // an unanswered tool_use is a 400, and findings were captured above.
      const assistantContent = LLM_THINKING_ENABLED
        ? (final.content.filter(b => b.type === "thinking" || b.type === "text") as unknown as Anthropic.Messages.ContentBlockParam[])
        : chunk;
      on.continuing();
      working = [
        ...working,
        { role: "assistant", content: assistantContent },
        { role: "user", content: "Продолжи с того места, где остановился. Не повторяй уже написанное." },
      ];
      continuations++;
    }

    // The model stopped to call a tool (record_findings / update_findings).
    // A tool call ends the response, so whatever the model meant to write
    // after it was lost — seen Nov 13 on a stage-2 reply cut mid-word. When
    // the visible text is empty or plainly unfinished, answer the tool call
    // and let the model finish the text. The tool input was captured above;
    // a repeated call in the continuation is ignored (record_findings) or
    // dropped as a repeat by validation (update_findings).
    resumeAfterTool = false;
    if (stopReason === "tool_use" && toolResumes < MAX_TOOL_RESUMES && looksUnfinished(fullText)) {
      const toolUses = final.content.filter(b => b.type === "tool_use") as Anthropic.Messages.ToolUseBlock[];
      if (toolUses.length > 0) {
        working = [
          ...working,
          { role: "assistant", content: final.content as unknown as Anthropic.Messages.ContentBlockParam[] },
          { role: "user", content: toolUses.map(t => ({
              type: "tool_result" as const, tool_use_id: t.id,
              content: "Принято. Продолжи ответ клиенту ровно с того места, где текст оборвался; не повторяй уже написанное и не вызывай инструменты повторно.",
            })) },
        ];
        toolResumes++;
        resumeAfterTool = true;
        console.log(`[audit:${label}] text unfinished at a tool call — resuming (${toolResumes})`);
      }
    }
  } while ((stopReason === "max_tokens" && continuations <= MAX_CONTINUATIONS) || resumeAfterTool);

  if (stopReason === "max_tokens") console.warn(`[audit:${label}] hit MAX_CONTINUATIONS — response may be truncated`);
  return { text: fullText, findings, updates, toolCalled, stopReason, tokensIn, tokensOut };
}

// Append the review request to the last user message (two user messages in
// a row are not allowed; the last message is always the client's).
function withReviewRequest(messages: Msg[], request: string): Msg[] {
  const out = [...messages];
  const last = out[out.length - 1];
  if (!last || last.role !== "user") return [...out, { role: "user", content: request }];
  out[out.length - 1] = typeof last.content === "string"
    ? { role: "user", content: `${last.content}\n\n${request}` }
    : { role: "user", content: [...last.content, { type: "text", text: request }] };
  return out;
}

// ── One audit turn, with pseudonymization at the boundary ────────────────────
// With a Pseudonymizer, the system prompt's dynamic part (audit context +
// documents) and every message text are coded BEFORE any call; both passes
// work entirely on coded text; everything coming back (answer text, thinking,
// draft, findings) is restored before it reaches the caller. If coding fails
// or a known personal value is still present, PseudonymizationError is thrown
// and nothing is sent (fail closed).
export async function runAuditTurn(
  system: string,
  messages: Msg[],
  cb: AuditCallbacks,
  pz?: Pseudonymizer,
  opts: TurnOptions = {},
): Promise<AuditTurnResult> {
  if (!pz) return runAuditTurnRaw(system, messages, cb, opts);

  // The static prompt is ours and has no personal data — it is not coded
  // (coding it could replace ordinary words that look like a client's surname).
  const hasStatic = system.startsWith(AUDIT_SYSTEM_PROMPT);
  const dynamic = hasStatic ? system.slice(AUDIT_SYSTEM_PROMPT.length) : system;
  const texts: string[] = [dynamic];
  const slots: { m: number; b: number | null }[] = [];
  messages.forEach((msg, m) => {
    if (typeof msg.content === "string") { texts.push(msg.content); slots.push({ m, b: null }); }
    else msg.content.forEach((block, b) => {
      if (block.type === "text") { texts.push(block.text); slots.push({ m, b }); }
      // Anything else (images, files) cannot be coded — never send it coded-mode.
      else throw new PseudonymizationError(`content block "${block.type}" cannot be pseudonymized`);
    });
  });

  // Names found by the Natasha service (if configured). Configured but
  // unavailable → PseudonymizationError → the audit is blocked.
  const detected = await detectNames(texts);
  if (detected) {
    for (const n of detected) pz.learnDetectedName(n.normal || n.text);
    console.log(`[audit] name service: ${detected.length} name span(s)`);
  }

  const coded = pz.encodeRequest(texts);   // throws PseudonymizationError → nothing sent
  const codedSystem = `${hasStatic ? AUDIT_SYSTEM_PROMPT : ""}${PSEUDONYM_NOTE}${coded[0]}`;
  const codedMessages: Msg[] = messages.map(msg => ({ ...msg, content: typeof msg.content === "string" ? msg.content : [...msg.content] })) as Msg[];
  slots.forEach((slot, i) => {
    const text = coded[i + 1];
    if (slot.b === null) codedMessages[slot.m] = { ...codedMessages[slot.m], content: text };
    else (codedMessages[slot.m].content as Anthropic.Messages.TextBlockParam[])[slot.b] = { type: "text", text };
  });
  console.log(`[audit] pseudonymized — persons: ${pz.stats.persons}, identifiers: ${pz.stats.identifiers}`);

  const textOut = pz.stream(cb.text), thinkOut = pz.stream(cb.thinking);
  const res = await runAuditTurnRaw(codedSystem, codedMessages, {
    step:     t => { thinkOut.flush(); cb.step(t); },
    thinking: d => thinkOut.push(d),
    text:     d => textOut.push(d),
    reset:    () => { textOut.clear(); cb.reset(); },
  }, opts);
  textOut.flush(); thinkOut.flush();
  if (pz.unknownTokens > 0) console.warn(`[audit] model used ${pz.unknownTokens} unknown code(s) — left as is`);

  const restorePass = (p: PassResult): PassResult => ({ ...p, text: pz.restore(p.text), findings: pz.restoreDeep(p.findings), updates: pz.restoreDeep(p.updates) });
  return { ...res, text: pz.restore(res.text), findings: pz.restoreDeep(res.findings), updates: pz.restoreDeep(res.updates),
    draft: res.draft ? restorePass(res.draft) : undefined };
}

async function runAuditTurnRaw(
  system: string,
  messages: Msg[],
  cb: AuditCallbacks,
  opts: TurnOptions = {},
): Promise<AuditTurnResult> {
  const extraTools = opts.extraTools ?? [];
  cb.step(LLM_THINKING_ENABLED
    ? `Передаю данные ИИ-аудитору (${AUDIT_MODEL}, глубокий анализ)`
    : `Передаю данные ИИ-аудитору (${AUDIT_MODEL})`);

  // Pass 1. Until we know whether this is a short reply or a full report,
  // hold the first GATE_CHARS of text: a short reply goes straight to the
  // client; a report becomes a draft (shown in the work panel only).
  let mode: "undecided" | "direct" | "draft" = AUDIT_REVIEW_ENABLED ? "undecided" : "direct";
  let held = "";
  let thinkingAnnounced = false;
  let directAnnounced = false;

  const goDirect = (d: string) => {
    if (!directAnnounced) { directAnnounced = true; cb.step("Пишу ответ"); }
    cb.text(d);
  };

  const p1 = await runPass(system, messages, {
    thinking: d => {
      if (!thinkingAnnounced) {
        thinkingAnnounced = true;
        cb.step("ИИ анализирует данные — ход рассуждений можно открыть ниже");
      }
      cb.thinking(d);
    },
    text: d => {
      if (mode === "direct") return goDirect(d);
      if (mode === "draft")  return cb.thinking(d);
      held += d;
      if (looksLikeReport(held)) {
        mode = "draft";
        cb.step("Составляю черновик отчёта");
        cb.thinking(`\n\n━━━ ЧЕРНОВИК ОТЧЁТА (до проверки) ━━━\n${held}`);
      } else if (held.length >= GATE_CHARS) {
        mode = "direct";
        goDirect(held);
      }
    },
    continuing: () => cb.step("Отчёт длинный — продолжаю"),
  }, "draft", extraTools);

  if (mode === "undecided") { mode = "direct"; if (held) goDirect(held); }

  const needsReview = AUDIT_REVIEW_ENABLED && (p1.toolCalled || looksLikeReport(p1.text));
  if (!needsReview) {
    return { text: p1.text, findings: p1.findings, updates: p1.updates, reviewed: "skipped", tokensIn: p1.tokensIn, tokensOut: p1.tokensOut };
  }

  // A report that slipped through as a direct answer (no report header in
  // its first lines): take it back, the client gets the reviewed version.
  if (mode === "direct") cb.reset();

  // Pass 2 — review.
  cb.step(`Черновик готов (выводов: ${p1.findings.length}). Контроль качества: проверяю каждый вывод по данным`);
  cb.thinking("\n\n━━━ КОНТРОЛЬ КАЧЕСТВА: ПРОВЕРКА ЧЕРНОВИКА ━━━\n");

  const fallback = (why: string, p2?: PassResult): AuditTurnResult => {
    console.warn(`[audit] review not used — ${why}; delivering the draft`);
    cb.reset();
    cb.step("Контроль качества не завершён — показан отчёт без повторной проверки");
    cb.text(p1.text);
    return { text: p1.text, findings: p1.findings, updates: p1.updates, reviewed: "failed", draft: p1,
      tokensIn: p1.tokensIn + (p2?.tokensIn ?? 0), tokensOut: p1.tokensOut + (p2?.tokensOut ?? 0) };
  };

  let p2: PassResult;
  let finalAnnounced = false;
  try {
    p2 = await runPass(system, withReviewRequest(messages, buildReviewRequest(p1.text, p1.findings)), {
      thinking: d => cb.thinking(d),
      text: d => {
        if (!finalAnnounced) { finalAnnounced = true; cb.step("Пишу итоговый отчёт"); }
        cb.text(d);
      },
      continuing: () => cb.step("Отчёт длинный — продолжаю"),
    }, "review", extraTools);
  } catch (err) {
    console.error("[audit] review pass error:", err);
    return fallback("review call failed");
  }

  // Accept the review only if it produced a complete report. If the draft
  // had findings and the review recorded none at all, treat it as
  // inconclusive rather than silently dropping every finding.
  if (p2.stopReason === "max_tokens")            return fallback("review cut off", p2);
  if (!looksLikeReport(p2.text) || p2.text.length < 500) return fallback("review returned no report", p2);
  if (!p2.toolCalled && p1.findings.length > 0)  return fallback("review recorded no findings although the draft had some", p2);

  cb.step(`Контроль качества завершён: в черновике выводов — ${p1.findings.length}, в итоговом отчёте — ${p2.findings.length}`);
  return { text: p2.text, findings: p2.findings, updates: p2.updates.length ? p2.updates : p1.updates, reviewed: "done", draft: p1,
    tokensIn: p1.tokensIn + p2.tokensIn, tokensOut: p1.tokensOut + p2.tokensOut };
}
