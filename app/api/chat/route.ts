import {
  AUDIT_SYSTEM_PROMPT, buildAuditContext, AUDIT_MODEL, LLM_SUPPORTS_IMAGES, LLM_PSEUDONYMIZE_ENABLED,
} from "@/lib/llm";
import { runAuditTurn } from "@/lib/audit-engine";
import { Pseudonymizer, PseudonymizationError } from "@/lib/pseudonymize";
import { createAdminClient } from "@/lib/supabase-server";
import { parseFile, renderPDFPagesAsImages, type DateRange } from "@/lib/file-parser";
import { billingSchemaReady } from "@/lib/doc-billing-server";
import { buildFindingsBlock, validateUpdates, UPDATE_FINDINGS_TOOL, type AgentFinding } from "@/lib/finding-updates";
import { findingsSchemaReady, loadAgentFindings, applyAgentUpdates } from "@/lib/finding-updates-server";
import { checkRequestVolume, isContextLimitError, CONTEXT_LIMIT_MESSAGE, type VolumePart } from "@/lib/volume";
import { NextRequest, NextResponse } from "next/server";

// Pro plan: up to 300s by default (800s with Fluid Compute enabled).
// 300 gives real headroom over the 6-call continuation loop below while
// staying under the Fluid Compute threshold — raise further only if audits
// are still timing out after streaming (this change) is confirmed live.
export const maxDuration = 300;

// ─── Fetch + parse ALL documents linked to this session ───────────────────────
// Returns text content for the system prompt PLUS a separate list of images
// (native vision — legacy Anthropic setup only; DeepSeek gets a
// "not analyzed" note instead, see UNREADABLE_IMAGE_NOTE).
interface DocumentsResult {
  textContent: string | null;
  images: { fileName: string; mediaType: string; base64: string }[];
  /** Text size of each document, for the request volume check. */
  sizes: VolumePart[];
  /** Individuals known by field from a 1C snapshot — coded as certain. */
  personNames: string[];
}

// Placeholder text for images / scanned PDFs while the audit model can't
// read them (DeepSeek). The instruction makes the model tell the client
// plainly which documents were skipped, rather than silently ignoring them.
function UNREADABLE_IMAGE_NOTE(fileName: string, kind: string): string {
  return `[Документ: ${fileName} — ${kind}. Распознавание изображений пока не подключено, ` +
    `содержимое этого документа НЕ передано на анализ. Обязательно сообщи пользователю, ` +
    `что этот документ не проанализирован, и предложи загрузить его в текстовом формате ` +
    `(PDF с текстовым слоем, XLSX, DOCX, выгрузка 1С).]`;
}

// Live progress (Nov 2026, same idea as Car-Parts session 29): each real
// step of the pipeline is sent to the chat as {type:"step", text} so the
// client sees what is actually happening instead of rotating fixed lines.
type StepFn = (text: string) => void;

// Russian plural for "операция" (1 операция, 2 операции, 5 операций).
function pluralOps(n: number): string {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} операция`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} операции`;
  return `${n} операций`;
}

async function getAllDocumentsContent(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string,
  period: DateRange | undefined,
  step: StepFn
): Promise<DocumentsResult> {
  const images: DocumentsResult["images"] = [];
  const sizes: VolumePart[] = [];
  const personNames: string[] = [];

  try {
    console.log("[chat] Looking up all documents for sessionId:", sessionId);

    // Only documents whose quote the client has confirmed are analysed
    // (Nov 2026). Before migration 005 there is no such column and every
    // document of the session is read, as before.
    const billingReady = await billingSchemaReady(supabase);
    const { data: allDocs, error: docErr } = await supabase
      .from("documents")
      .select(billingReady
        ? "storage_path, file_name, file_type, page_count, billing_status"
        : "storage_path, file_name, file_type, page_count")
      .eq("session_id", sessionId)
      .order("uploaded_at", { ascending: true });

    type DocRow = { storage_path: string; file_name: string; file_type: string; page_count: number | null; billing_status?: string };
    const rows = (allDocs ?? []) as unknown as DocRow[];
    const docs = billingReady ? rows.filter(d => d.billing_status === "confirmed") : rows;
    const waiting = billingReady ? rows.filter(d => d.billing_status === "pending") : [];
    if (waiting.length > 0) {
      step(`Ожидают подтверждения стоимости и не анализируются: ${waiting.map(d => `«${d.file_name}»`).join(", ")}`);
    }

    if (docErr) {
      console.error("[chat] Document lookup error:", docErr.message);
      return { textContent: null, images, sizes, personNames };
    }
    if (!docs || docs.length === 0) {
      console.warn("[chat] No documents found for session:", sessionId);
      return { textContent: null, images, sizes, personNames };
    }

    console.log(`[chat] Found ${docs.length} document(s) for session`);
    step(docs.length === 1 ? "Найден 1 документ сессии" : `Найдено документов сессии: ${docs.length}`);

    const sections: string[] = [];

    for (const doc of docs) {
      if (!doc.storage_path) continue;

      console.log("[chat] Downloading:", doc.file_name, "— file_type:", doc.file_type);
      step(`Читаю «${doc.file_name}»`);

      const { data: blob, error: dlErr } = await supabase
        .storage
        .from("audit-documents")
        .download(doc.storage_path);

      if (dlErr || !blob) {
        console.error("[chat] Download failed for", doc.file_name, ":", dlErr?.message);
        sections.push(`[Документ: ${doc.file_name} — ошибка загрузки: ${dlErr?.message}]`);
        continue;
      }

      console.log("[chat] Downloaded", doc.file_name, "—", blob.size, "bytes");

      const arrayBuffer = await blob.arrayBuffer();

      // ── Images: Claude vision (legacy) or a "not analyzed" note (DeepSeek) ─
      // doc.file_type === "image" covers both JPG and PNG (see upload route's
      // ALLOWED_TYPES mapping). Claude Sonnet 5 reads images directly —
      // there is no OCR step here, the model itself does the reading.
      if (doc.file_type === "image") {
        // DeepSeek V4 Pro has no image input, and image bytes must never be
        // uploaded to DeepSeek (152-FZ) — tell the model the document was
        // NOT analyzed so it says so instead of guessing. Server-side OCR
        // (PUNCH_LIST Step B) will turn these into text.
        if (!LLM_SUPPORTS_IMAGES) {
          step(`«${doc.file_name}» — изображение, пропущено: распознавание сканов ещё не подключено`);
          sections.push(UNREADABLE_IMAGE_NOTE(doc.file_name, "изображение"));
          continue;
        }
        const ext       = doc.file_name?.split(".").pop()?.toLowerCase();
        const mediaType = ext === "png" ? "image/png" : "image/jpeg";
        const base64    = Buffer.from(arrayBuffer).toString("base64");
        images.push({ fileName: doc.file_name, mediaType, base64 });
        sections.push(`[Документ: ${doc.file_name} — изображение, передано модели напрямую для визуального анализа]`);
        continue;
      }

      // ── Everything else: trust doc.file_type from the DB ─────────────────
      // This was already correctly classified at upload time in /api/upload
      // (including 1C-format sniffing via is1CClientBankExchange), so we use
      // it directly instead of re-deriving from the filename extension here,
      // which previously caused .doc/.txt(1C)/.pdf to silently misparse as xlsx.
      const PARSEABLE_TYPES = new Set(["xlsx", "xls", "csv", "xml", "docx", "doc", "1c_txt", "pdf", "1c_odata"]);

      if (!PARSEABLE_TYPES.has(doc.file_type)) {
        sections.push(`[Документ: ${doc.file_name} — тип "${doc.file_type}" не поддерживается для текстового анализа]`);
        continue;
      }

      // period scopes rows to the audit's selected date range for xlsx/xls/csv
      // (file-parser.ts ignores it for other formats) — same period_from/
      // period_to used by /api/upload and /api/audit/calculate-price, so the
      // AI only ever sees what the client was priced and asked to analyze.
      const parsed = await parseFile(
        arrayBuffer,
        doc.file_type as "xlsx" | "xls" | "csv" | "xml" | "docx" | "doc" | "1c_txt" | "pdf",
        period
      );

      console.log("[chat]", doc.file_name, "— rowCount:", parsed.rowCount,
        "textContent length:", parsed.textContent?.length ?? 0,
        "likelyScanned:", parsed.likelyScanned ?? false);

      // ── Scanned PDF fallback: render pages as images, route through vision ──
      // parsePDF() sets likelyScanned=true when it found no real text layer
      // (common for photographed/scanned invoices, contracts, statements).
      // Instead of sending the AI an empty document, render each page to a
      // PNG and attach it the same way as a directly-uploaded JPG/PNG.
      if (doc.file_type === "pdf" && parsed.likelyScanned) {
        if (!LLM_SUPPORTS_IMAGES) {
          console.log("[chat]", doc.file_name, "— scanned PDF detected, OCR not available yet — not sent");
          step(`«${doc.file_name}» — скан без текста, пропущен: распознавание сканов ещё не подключено`);
          sections.push(UNREADABLE_IMAGE_NOTE(doc.file_name, "отсканированный PDF без текстового слоя"));
          continue;
        }
        console.log("[chat]", doc.file_name, "— scanned PDF detected, rendering pages as images");
        const pageImages = await renderPDFPagesAsImages(arrayBuffer, 10);

        if (pageImages.length > 0) {
          for (const page of pageImages) {
            images.push({
              fileName: `${doc.file_name} (стр. ${page.pageNumber})`,
              mediaType: page.mediaType,
              base64: page.base64,
            });
          }
          sections.push(
            `[Документ: ${doc.file_name} — отсканированный PDF, ${pageImages.length} стр. передано модели как изображения для визуального анализа]`
          );
        } else {
          sections.push(
            `[Документ: ${doc.file_name} — отсканированный PDF, не удалось отрендерить страницы как изображения]`
          );
        }
        continue;
      }

      step(parsed.rowCount > 0
        ? `«${doc.file_name}»: ${pluralOps(parsed.rowCount)}${period?.dateFrom || period?.dateTo ? " за период аудита" : ""}`
        : `«${doc.file_name}» прочитан`);

      const header = [
        `Файл: ${doc.file_name}`,
        `Формат: ${parsed.parseMethod.toUpperCase()}`,
        parsed.sheetName ? `Лист: ${parsed.sheetName}` : null,
        `Строк данных: ${parsed.rowCount}`,
        parsed.detectedColumns?.length
          ? `Колонки: ${parsed.detectedColumns.join(" | ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      const content = parsed.textContent
        || `[Содержимое не извлечено. Строк: ${parsed.rowCount}]`;

      sizes.push({ name: doc.file_name, chars: content.length });
      if (parsed.personNames?.length) personNames.push(...parsed.personNames);
      sections.push(
        `=== ДОКУМЕНТ: ${doc.file_name} ===\n${header}\n\n${content}\n=== КОНЕЦ: ${doc.file_name} ===`
      );
    }

    if (sections.length === 0) return { textContent: null, images, sizes, personNames };

    const intro = docs.length > 1 ? `Загружено документов: ${docs.length}\n\n` : "";
    return { textContent: intro + sections.join("\n\n"), images, sizes, personNames };

  } catch (err) {
    console.error("[chat] getAllDocumentsContent exception:", err);
    return { textContent: null, images, sizes, personNames };
  }
}

// ─── Title normalization + similarity for dedup ────────────────────────────
// Deliberately simple (word-overlap ratio, not embeddings/fuzzy-string
// libraries) — this only needs to catch "same finding, slightly different
// wording" (e.g. "Отсутствие подтверждающих документов" vs "Отсутствуют
// подтверждающие документы по операциям"), not do general-purpose semantic
// matching. False negatives here are recoverable (worst case: an occasional
// near-duplicate slips through, same as before this fix); false positives
// would be worse (a genuinely new finding silently dropped), so the
// threshold below is deliberately conservative (high overlap required).
function normalizeTitle(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ") // strip punctuation, keep letters/digits (unicode-aware for Cyrillic)
      .split(/\s+/)
      .filter(w => w.length > 2) // drop short connector words (short in Russian too, e.g. "по", "не")
  );
}

function titleSimilarity(a: string, b: string): number {
  const setA = normalizeTitle(a);
  const setB = normalizeTitle(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const word of setA) if (setB.has(word)) overlap++;
  return overlap / Math.min(setA.size, setB.size); // ratio vs. the shorter title
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.7;

// ─── Save findings extracted via record_findings tool_use ─────────────────────
// Haiku removed (July 2026) — Sonnet now emits structured findings directly via
// tool_use on the same call that writes the report text, instead of a second
// model re-interpreting the first model's prose. This function only validates
// and persists what the tool call already produced; it makes no LLM call itself.
// Still defensively validated below: tool_use input is schema-guided, not
// schema-enforced, so a malformed/out-of-enum value from the model is still
// possible and must not corrupt the DB or silently overstate certainty.
//
// DEDUP (July 2026): app-level safety net on top of the prompt-level fix
// (Sonnet is now told what's already been found and asked not to re-report
// it — see AUDIT_SYSTEM_PROMPT / buildAuditContext). This guard exists
// because the prompt instruction is a request, not an enforced constraint —
// same reasoning as the toolCallSeen guard below it. Checks both against
// findings already in the DB (existingTitles) AND against other findings
// in this same tool_use call (Sonnet could still emit two near-identical
// findings in one call), since without the second check duplicates could
// still slip in even with the DB check working perfectly.
async function saveFindings(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string,
  clientId: string,
  findings: any[],
  existingTitles: string[]
): Promise<{ saved: number; skipped: number }> {
  const none = { saved: 0, skipped: 0 };
  try {
    if (!Array.isArray(findings) || findings.length === 0) return none;

    const validRiskLevels      = new Set(["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"]);
    const validEvidenceStatuses = new Set(["confirmed", "risk_flag", "indirect"]);

    const acceptedTitles: string[] = [...existingTitles];
    const rows: any[] = [];

    for (const f of findings) {
      if (!f?.title || !validRiskLevels.has(f.risk_level)) continue;

      const title = String(f.title).slice(0, 100);
      const isDuplicate = acceptedTitles.some(
        existing => titleSimilarity(title, existing) >= DUPLICATE_SIMILARITY_THRESHOLD
      );

      if (isDuplicate) {
        console.warn(`[chat] Skipping likely-duplicate finding: "${title}"`);
        continue;
      }

      rows.push({
        session_id:      sessionId,
        client_id:       clientId,
        title,
        risk_level:      f.risk_level,
        // Default to the middle tier ("risk_flag") rather than "confirmed" if
        // the tool call omits or mis-formats this field — never let a missing
        // value silently overstate certainty.
        evidence_status: validEvidenceStatuses.has(f.evidence_status) ? f.evidence_status : "risk_flag",
        description:     String(f.description    || "").slice(0, 500),
        legal_basis:     String(f.legal_basis    || "").slice(0, 200),
        recommendation:  String(f.recommendation || "").slice(0, 300),
        status:          "open",
      });
      acceptedTitles.push(title); // also guards against dupes within this same batch
    }

    if (rows.length === 0) return { saved: 0, skipped: findings.length };

    const { error } = await supabase.from("findings").insert(rows);
    if (error) {
      console.error("[chat] Failed to save findings:", error.message);
      return none;
    } else {
      console.log(`[chat] Saved ${rows.length} finding(s) to DB (${findings.length - rows.length} skipped as duplicates)`);

      // Update findings_ct on the session
      const { data: sess } = await supabase
        .from("audit_sessions")
        .select("findings_ct")
        .eq("id", sessionId)
        .single();

      await supabase
        .from("audit_sessions")
        .update({ findings_ct: (sess?.findings_ct || 0) + rows.length })
        .eq("id", sessionId);
      return { saved: rows.length, skipped: findings.length - rows.length };
    }
  } catch (err) {
    console.error("[chat] saveFindings error:", err);
    // Never throw — findings persistence is non-critical to the chat response
    return none;
  }
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { messages, sessionId, clientId, context } = await req.json();

    console.log("[chat] POST — clientId:", clientId, "sessionId:", sessionId);

    if (!clientId || !messages) {
      return NextResponse.json(
        { error: "clientId и messages обязательны" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Check client is active
    const { data: profile } = await supabase
      .from("profiles")
      .select("status, company_name")
      .eq("id", clientId)
      .single();

    if (!profile || profile.status !== "active") {
      return NextResponse.json(
        { error: "Аккаунт приостановлен или не найден. Обратитесь к администратору." },
        { status: 403 }
      );
    }

    // ─── Streaming response ─────────────────────────────────────────────────
    // Was: buffer the full response (potentially 6 sequential Anthropic calls
    // + parsing) then return one NextResponse.json(). That meant the HTTP
    // response didn't start until EVERYTHING was done — if total time exceeded
    // maxDuration, Vercel killed the function and the client got a raw 504
    // HTML page instead of any answer, even though the backend had often
    // finished the actual audit work and written it to Supabase.
    //
    // Now: text is streamed to the client as newline-delimited JSON (NDJSON)
    // events the instant Claude produces it. Two things this fixes:
    //   1. The user sees the report appear in real time instead of a frozen
    //      "thinking" indicator for 30s-2min+.
    //   2. If Vercel's maxDuration is ever hit mid-stream, the client has
    //      already received partial content instead of nothing at all.
    // NOTE: streaming does NOT lift the maxDuration ceiling itself — total
    // work still must fit inside `maxDuration` (300s, see top of file). This
    // fixes the "silent 504 + stuck UI" failure mode; it doesn't make an
    // arbitrarily long audit run forever. See PROJECT_STATUS.md.
    //
    // Event shapes sent, one per line:
    //   { type: "step", text: string }         — a real pipeline step (checklist line)
    //   { type: "thinking", text: string }     — a chunk of the model's real thinking
    //   { type: "delta", text: string }        — a chunk of report text
    //   { type: "reset" }                      — discard answer text sent so far
    //   { type: "done", message: string }       — final full text, stream ends
    //   { type: "error", error: string }        — something failed mid-stream
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        function send(obj: Record<string, unknown>) {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        }
        // A real pipeline step, shown as a checklist line in the chat.
        const step: StepFn = (text) => send({ type: "step", text });

        // The model's real thinking, streamed to the chat's collapsible
        // «Ход рассуждений» panel. Deltas are small and frequent, so they're
        // batched and flushed every ~300 ms. ⚠️ Once pseudonymization is
        // built (Step C), the restorer must run on this text too.
        let thinkingBuffer = "";
        const flushThinking = () => {
          if (thinkingBuffer) { send({ type: "thinking", text: thinkingBuffer }); thinkingBuffer = ""; }
        };
        const thinkingFlush = setInterval(flushThinking, 300);

        // ─── Heartbeat ──────────────────────────────────────────────────────
        // Real-world case that motivated this: a request where Claude took
        // ~150s to produce its first visible text (all internal reasoning +
        // tool prep before any "text" delta fired). No bytes flowed to the
        // client for that entire span. The server finished fine and saved
        // everything to Supabase — but the browser's stream reader errored
        // out before the final payload arrived. Given the mandatory RU →
        // Vercel proxy hop in this deployment, the leading suspect is an
        // idle-connection timeout somewhere in that path (proxy, CDN, or
        // even the browser itself) killing a connection with no data flowing
        // for too long, even though the origin was still alive and working.
        //
        // Fix: emit a trivial no-op event every 15s so bytes never stop
        // flowing, regardless of how long Claude takes to produce its first
        // real token. The client (streamChat in page.tsx) just ignores any
        // event type it doesn't recognize, so this is fully backward-safe.
        const HEARTBEAT_INTERVAL_MS = 15000;
        const heartbeat = setInterval(() => {
          try {
            send({ type: "heartbeat" });
          } catch {
            // controller may already be closed — interval is cleared below
            // in the finally-equivalent cleanup either way, this is just a
            // defensive no-op if a tick races the close.
          }
        }, HEARTBEAT_INTERVAL_MS);

        try {
          step("Читаю документы аудита");
          // Fetch and parse ALL uploaded documents for this session.
          // Images are handled separately — on the legacy Anthropic setup they go to Claude's native vision as
          // image content blocks on the user message, not as text in the prompt.
          let fileSection = "";
          let images: { fileName: string; mediaType: string; base64: string }[] = [];
          let docSizes: VolumePart[] = [];
          let knownPersons: string[] = [];
          if (sessionId) {
            // Look up the audit's selected period so document parsing only
            // includes rows inside it — same period_from/period_to written by
            // create_audit_session and read by /api/upload and
            // /api/audit/calculate-price, so pricing and analysis always agree
            // on which rows count (see PROJECT_STATUS.md period-filtering fix).
            const { data: periodRow } = await supabase
              .from("audit_sessions")
              .select("period_from, period_to")
              .eq("id", sessionId)
              .single();

            const period: DateRange | undefined = periodRow
              ? { dateFrom: periodRow.period_from ?? undefined, dateTo: periodRow.period_to ?? undefined }
              : undefined;

            const docsResult = await getAllDocumentsContent(supabase, sessionId, period, step);
            images = docsResult.images;
            docSizes = docsResult.sizes;
            knownPersons = docsResult.personNames;
            if (docsResult.textContent) {
              fileSection = `\n\n=== ЗАГРУЖЕННЫЕ ФИНАНСОВЫЕ ДОКУМЕНТЫ ===\n${docsResult.textContent}\n=== КОНЕЦ ДОКУМЕНТОВ ===`;
              console.log("[chat] File section length:", fileSection.length);
            } else {
              console.warn("[chat] No file content for session:", sessionId);
            }
            if (images.length > 0) {
              console.log("[chat] Attaching", images.length, "image(s) for vision analysis");
            }
          }

          // Fetch findings already saved in this session (July 2026, duplicate-
          // findings fix). Used two ways below: (1) passed into buildAuditContext
          // so Sonnet sees what's already been reported and can avoid re-emitting
          // it via record_findings; (2) passed into saveFindings as a second,
          // app-level dedup check after the response comes back — the prompt
          // instruction alone is a request, not an enforced constraint.
          let existingFindings: { title: string; risk_level: string; evidence_status: string }[] = [];
          if (sessionId) {
            const { data: existingRows, error: existingErr } = await supabase
              .from("findings")
              .select("title, risk_level, evidence_status")
              .eq("session_id", sessionId)
              .eq("status", "open");

            if (existingErr) {
              console.error("[chat] Failed to fetch existing findings for dedup:", existingErr.message);
            } else {
              existingFindings = existingRows || [];
              console.log("[chat] Existing open findings in session:", existingFindings.length);
              if (existingFindings.length > 0) step(`Учитываю ранее выявленные нарушения: ${existingFindings.length}`);
            }
          }

          // Stage 2 (Nov 2026): once the audit has findings, the agent is shown
          // them with codes and the rules for closing, and gets a second tool
          // to PROPOSE closing — see lib/finding-updates.ts. Until migration
          // 006 has been run this is absent and the turn runs as before.
          let agentFindings: AgentFinding[] = [];
          if (sessionId && await findingsSchemaReady(supabase)) {
            agentFindings = await loadAgentFindings(supabase, sessionId);
          }
          const findingsBlock = buildFindingsBlock(agentFindings);
          const stage2 = agentFindings.some(f => f.status === "open");

          // Build system prompt: base + audit context + all file contents
          // (the stage-2 block replaces the older plain list of finding titles).
          const systemPrompt = (context
            ? `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext({ ...context, existingFindings: findingsBlock ? [] : existingFindings })}${fileSection}`
            : `${AUDIT_SYSTEM_PROMPT}${fileSection}`) + (findingsBlock ? `\n\n${findingsBlock}` : "");

          console.log("[chat] System prompt length:", systemPrompt.length,
            "| Model:", AUDIT_MODEL,
            "| Has files:", fileSection.length > 0);

          // ── Volume check: refuse, never cut ───────────────────────────────
          // The parsers pass every row through. If the whole request is more
          // than the model can take in one call, stop here with a clear
          // message — no model call, nothing shortened. See lib/volume.ts.
          const historyChars = (messages as { content?: unknown }[]).reduce(
            (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0), 0);
          const docChars = docSizes.reduce((sum, d) => sum + d.chars, 0);
          const volume = checkRequestVolume(systemPrompt.length - docChars + historyChars, docSizes);
          console.log("[chat] request volume:", volume.totalChars, "chars | limit:", volume.limitChars);
          if (!volume.ok) {
            console.warn("[chat] request over the model limit — NOT sent");
            step("Объём документов превышает предел одного запроса — анализ не запущен");
            send({ type: "error", error: volume.message });
            clearInterval(heartbeat);
            clearInterval(thinkingFlush);
            controller.close();
            return;
          }

          let fullText = "";
          let workingMessages = [...messages];

          // Attach any images to the last user message as vision content blocks.
          // Images are only attached on this first call, not on continuation
          // calls, since Claude already has them in context once seen.
          if (images.length > 0 && LLM_SUPPORTS_IMAGES) {
            const lastIdx = workingMessages.length - 1;
            if (lastIdx >= 0 && workingMessages[lastIdx].role === "user") {
              const existingText = typeof workingMessages[lastIdx].content === "string"
                ? workingMessages[lastIdx].content
                : "";
              workingMessages[lastIdx] = {
                role: "user",
                content: [
                  ...images.map(img => ({
                    type:   "image" as const,
                    source: { type: "base64" as const, media_type: img.mediaType as "image/jpeg" | "image/png", data: img.base64 },
                  })),
                  { type: "text" as const, text: existingText || "Проанализируй приложенные изображения документов." },
                ],
              };
            }
          }

          // Draft pass + quality-review pass — see lib/audit-engine.ts. Only
          // the final (reviewed) text reaches the client as the answer; the
          // draft and all reasoning go to the «Ход рассуждений» panel.
          if (LLM_PSEUDONYMIZE_ENABLED) step("Обезличиваю персональные данные перед отправкой");
          // Individuals a 1C base names in its own fields are coded as certain
          // (no guessing from text); see lib/c1-reader.ts.
          const pseudonymizer = LLM_PSEUDONYMIZE_ENABLED ? new Pseudonymizer() : undefined;
          if (pseudonymizer) for (const n of knownPersons) pseudonymizer.learnDetectedName(n);
          const result = await runAuditTurn(systemPrompt, workingMessages, {
            step,
            thinking: d => { thinkingBuffer += d; },
            text:     d => { flushThinking(); fullText += d; send({ type: "delta", text: d }); },
            reset:    () => { fullText = ""; send({ type: "reset" }); },
          }, pseudonymizer, stage2 ? { extraTools: [UPDATE_FINDINGS_TOOL] } : {});
          fullText = result.text; // authoritative
          const toolFindings = result.findings as any[];
          console.log("[chat] audit turn done — reviewed:", result.reviewed,
            "| findings:", toolFindings.length, "| tokens in/out:", result.tokensIn, "/", result.tokensOut);

          flushThinking();
          if (toolFindings.length > 0) step(`Фиксирую выявленные нарушения: ${toolFindings.length}`);

          const [, savedResult] = await Promise.all([
            supabase.from("audit_messages").insert({
              session_id: sessionId,
              client_id:  clientId,
              role:       "assistant",
              content:    fullText,
            }),

            saveFindings(supabase, sessionId, clientId, toolFindings, existingFindings.map(f => f.title)),
          ]);
          if (savedResult.saved > 0 || savedResult.skipped > 0) {
            step(`Сохранено новых нарушений: ${savedResult.saved}` +
              (savedResult.skipped > 0 ? ` (повторов пропущено: ${savedResult.skipped})` : ""));
          }

          // Stage 2: record what the agent concluded about existing findings.
          // A proposal changes nothing by itself — the client decides.
          if (stage2 && result.updates.length > 0) {
            const { valid, skipped } = validateUpdates(result.updates, agentFindings);
            if (skipped.length > 0) console.warn("[chat] finding updates skipped:", skipped.join(" | "));
            const applied = await applyAgentUpdates(supabase, sessionId, valid, agentFindings);
            console.log("[chat] finding updates — proposals:", applied.proposals.length, "| kept open:", applied.keptOpen);
            if (applied.proposals.length > 0) {
              step(`Предложено к закрытию: ${applied.proposals.length} — решение за вами`);
              send({ type: "proposals", proposals: applied.proposals });
            }
            if (applied.keptOpen > 0) step(`Остаются открытыми с уточнением, чего не хватает: ${applied.keptOpen}`);
          }

          send({ type: "done", message: fullText });
          clearInterval(heartbeat);
          clearInterval(thinkingFlush);
          controller.close();

        } catch (err) {
          if (err instanceof PseudonymizationError) {
            // Fail closed: nothing was sent to the LLM. The message never
            // contains personal data (see lib/pseudonymize.ts).
            console.error("[chat] pseudonymization failed — request NOT sent:", err.message);
            send({ type: "error", error: /service unavailable/.test(err.message)
              ? "Сервис обезличивания персональных данных временно недоступен, поэтому запрос не был отправлен на анализ. Данные никуда не переданы. Повторите попытку позже или обратитесь в поддержку."
              : "Не удалось обезличить персональные данные в документах, поэтому запрос не был отправлен на анализ. Данные никуда не переданы. Обратитесь в поддержку." });
          } else if (isContextLimitError(err)) {
            console.error("[chat] model rejected the request size:", (err as Error)?.message);
            send({ type: "error", error: CONTEXT_LIMIT_MESSAGE });
          } else {
            console.error("[chat] stream error:", err);
            send({ type: "error", error: "Внутренняя ошибка сервера во время генерации ответа" });
          }
          clearInterval(heartbeat);
          clearInterval(thinkingFlush);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        // Disables buffering on some proxy layers (esp. relevant given the
        // RU → Vercel proxy path) so chunks aren't held and released in one
        // burst, which would defeat the point of streaming.
        "X-Accel-Buffering": "no",
      },
    });

  } catch (err) {
    console.error("[chat] route error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
