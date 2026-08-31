import { anthropic, AUDIT_SYSTEM_PROMPT, buildAuditContext, SONNET_MODEL, FINDINGS_TOOL } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase-server";
import { parseFile, renderPDFPagesAsImages } from "@/lib/file-parser";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60; // Hobby's ceiling — real fix is still needed for longer runs

// ─── Fetch + parse ALL documents linked to this session ───────────────────────
// Returns text content for the system prompt PLUS a separate list of images
// (for native vision, not text extraction — Claude reads images directly).
interface DocumentsResult {
  textContent: string | null;
  images: { fileName: string; mediaType: string; base64: string }[];
}

async function getAllDocumentsContent(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string
): Promise<DocumentsResult> {
  const images: DocumentsResult["images"] = [];

  try {
    console.log("[chat] Looking up all documents for sessionId:", sessionId);

    const { data: docs, error: docErr } = await supabase
      .from("documents")
      .select("storage_path, file_name, file_type, page_count")
      .eq("session_id", sessionId)
      .order("uploaded_at", { ascending: true });

    if (docErr) {
      console.error("[chat] Document lookup error:", docErr.message);
      return { textContent: null, images };
    }
    if (!docs || docs.length === 0) {
      console.warn("[chat] No documents found for session:", sessionId);
      return { textContent: null, images };
    }

    console.log(`[chat] Found ${docs.length} document(s) for session`);

    const sections: string[] = [];

    for (const doc of docs) {
      if (!doc.storage_path) continue;

      console.log("[chat] Downloading:", doc.file_name, "— file_type:", doc.file_type);

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

      // ── Images go to Claude's native vision, not text extraction ─────────
      // doc.file_type === "image" covers both JPG and PNG (see upload route's
      // ALLOWED_TYPES mapping). Claude Sonnet 5 reads images directly —
      // there is no OCR step here, the model itself does the reading.
      if (doc.file_type === "image") {
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
      const PARSEABLE_TYPES = new Set(["xlsx", "xls", "csv", "xml", "docx", "doc", "1c_txt", "pdf"]);

      if (!PARSEABLE_TYPES.has(doc.file_type)) {
        sections.push(`[Документ: ${doc.file_name} — тип "${doc.file_type}" не поддерживается для текстового анализа]`);
        continue;
      }

      const parsed = await parseFile(
        arrayBuffer,
        doc.file_type as "xlsx" | "xls" | "csv" | "xml" | "docx" | "doc" | "1c_txt" | "pdf"
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

      sections.push(
        `=== ДОКУМЕНТ: ${doc.file_name} ===\n${header}\n\n${content}\n=== КОНЕЦ: ${doc.file_name} ===`
      );
    }

    if (sections.length === 0) return { textContent: null, images };

    const intro = docs.length > 1 ? `Загружено документов: ${docs.length}\n\n` : "";
    return { textContent: intro + sections.join("\n\n"), images };

  } catch (err) {
    console.error("[chat] getAllDocumentsContent exception:", err);
    return { textContent: null, images };
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
): Promise<void> {
  try {
    if (!Array.isArray(findings) || findings.length === 0) return;

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

    if (rows.length === 0) return;

    const { error } = await supabase.from("findings").insert(rows);
    if (error) {
      console.error("[chat] Failed to save findings:", error.message);
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
    }
  } catch (err) {
    console.error("[chat] saveFindings error:", err);
    // Never throw — findings persistence is non-critical to the chat response
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

    // Fetch and parse ALL uploaded documents for this session.
    // Images are handled separately — they go to Claude's native vision as
    // image content blocks on the user message, not as text in the prompt.
    let fileSection = "";
    let images: { fileName: string; mediaType: string; base64: string }[] = [];
    if (sessionId) {
      const docsResult = await getAllDocumentsContent(supabase, sessionId);
      images = docsResult.images;
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
      }
    }

    // Build system prompt: base + audit context + all file contents
    const systemPrompt = context
      ? `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext({ ...context, existingFindings })}${fileSection}`
      : `${AUDIT_SYSTEM_PROMPT}${fileSection}`;

    console.log("[chat] System prompt length:", systemPrompt.length,
      "| Model:", SONNET_MODEL,
      "| Has files:", fileSection.length > 0);

    // Main audit call — Sonnet for deep legal and financial reasoning.
    // Audit reports can be long (multi-section, tables, per-month breakdowns),
    // so we raise max_tokens and auto-continue server-side if the model is
    // cut off mid-response (stop_reason === "max_tokens"), instead of making
    // the user notice the truncation and type "continue" themselves.
    const MAX_OUTPUT_TOKENS = 16000; // per-call cap (well under Sonnet 5's 128K ceiling — raise if reports need more headroom)
    const MAX_CONTINUATIONS = 5;     // hard safety limit on auto-continue loops

    let fullText = "";
    let workingMessages = [...messages];

    // Attach any images to the last user message as vision content blocks.
    // Images are only attached on this first call, not on continuation calls,
    // since Claude already has them in context once seen.
    if (images.length > 0) {
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

    let continuations = 0;
    let stopReason: string | null = null;
    let toolFindings: any[] = [];
    let toolCallSeen = false; // true once record_findings has fired — see guard below

    do {
      const response = await anthropic.messages.create({
        model:       SONNET_MODEL,
        max_tokens:  MAX_OUTPUT_TOKENS,
        system:      systemPrompt,
        messages:    workingMessages,
        tools:       [FINDINGS_TOOL],
        tool_choice: { type: "auto" },
      });

      // A single response can contain a text block AND a tool_use block
      // (model writes the full report, then calls record_findings once at
      // the end) — content[0] is no longer a safe assumption now that a
      // tool is attached, so all blocks are walked explicitly.
      //
      // GUARD: record_findings must fire at most once across the ENTIRE
      // do/while loop, not once per iteration. Nothing in the API prevents
      // the model from calling the tool again on a later continuation
      // (e.g. once mid-report before hitting max_tokens, then again after
      // "continue" — possibly with different/conflicting evidence_status
      // values for what's meant to be the same finding). The system prompt
      // asks for exactly one call, but that's a request, not an enforced
      // constraint — so it's enforced here instead.
      let chunk = "";
      for (const block of response.content) {
        if (block.type === "text") {
          chunk += block.text;
        } else if (block.type === "tool_use" && block.name === "record_findings") {
          if (toolCallSeen) {
            console.warn(
              "[chat] record_findings called again after an earlier call in this turn — " +
              "ignoring this second call to prevent duplicate/conflicting findings. " +
              "This should not happen per AUDIT_SYSTEM_PROMPT; investigate if seen repeatedly."
            );
            continue;
          }
          const input = block.input as { findings?: any[] };
          if (Array.isArray(input?.findings)) {
            toolFindings = input.findings;
            toolCallSeen = true;
          }
        }
      }

      fullText += chunk;
      stopReason = response.stop_reason;

      console.log("[chat] Sonnet call — stop_reason:", stopReason,
        "| chunk length:", chunk.length, "| total so far:", fullText.length,
        "| findings captured:", toolFindings.length);

      if (stopReason === "max_tokens" && continuations < MAX_CONTINUATIONS) {
        // Feed the partial response back as assistant history and ask the
        // model to continue exactly where it left off — no "continue" prompt
        // needed from the user, and no duplicated/rephrased seam text.
        workingMessages = [
          ...workingMessages,
          { role: "assistant", content: chunk },
          { role: "user", content: "Продолжи с того места, где остановился. Не повторяй уже написанное." },
        ];
        continuations++;
      }
      // stop_reason === "tool_use" means the model finished its report text
      // and made its one record_findings call per AUDIT_SYSTEM_PROMPT's
      // instructions — that's a normal, complete turn, not truncation, so
      // the loop ends here rather than trying to "continue" generation.
    } while (stopReason === "max_tokens" && continuations <= MAX_CONTINUATIONS);

    if (stopReason === "max_tokens") {
      console.warn("[chat] Hit MAX_CONTINUATIONS limit — response may still be truncated");
    }

    const text = fullText;

    // Save message and persist any findings captured via tool_use, in parallel.
    // No second model call here anymore — saveFindings only validates and
    // inserts what Sonnet already produced in the same request above.
    await Promise.all([
      supabase.from("audit_messages").insert({
        session_id: sessionId,
        client_id:  clientId,
        role:       "assistant",
        content:    text,
      }),

      saveFindings(supabase, sessionId, clientId, toolFindings, existingFindings.map(f => f.title)),
    ]);

    return NextResponse.json({ message: text });

  } catch (err) {
    console.error("[chat] route error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
