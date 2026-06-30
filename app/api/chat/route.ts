import { anthropic, AUDIT_SYSTEM_PROMPT, buildAuditContext, SONNET_MODEL, HAIKU_MODEL } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase-server";
import { parseFile, renderPDFPagesAsImages } from "@/lib/file-parser";
import { NextRequest, NextResponse } from "next/server";

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
      // ALLOWED_TYPES mapping). Claude Sonnet 4.6 reads images directly —
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

// ─── Extract and save findings from Claude's response ─────────────────────────
// Uses Haiku for cost-efficient JSON extraction — no deep reasoning needed here.
async function extractAndSaveFindings(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string,
  clientId: string,
  assistantText: string
): Promise<void> {
  try {
    // Only run if response contains violation keywords
    const hasViolations = /нарушени|критич|риск|штраф|КРИТИЧНО|СУЩЕСТВЕННО|НЕСУЩЕСТВЕННО/i.test(assistantText);
    if (!hasViolations) return;

    // Ask Claude Haiku to extract structured findings (pure JSON parsing, no reasoning needed)
    const extractRes = await anthropic.messages.create({
      model:      HAIKU_MODEL,
      max_tokens: 4096, // raised from 1500 — longer reports can have many more findings to extract as JSON
      system: `Ты — парсер аудиторских отчётов. Извлеки все нарушения из текста аудитора.
Верни ТОЛЬКО валидный JSON массив, без пояснений, без markdown, без backticks.
Каждый объект должен содержать:
{
  "title": "краткое название нарушения (до 100 символов)",
  "risk_level": "КРИТИЧНО" | "СУЩЕСТВЕННО" | "НЕСУЩЕСТВЕННО",
  "evidence_status": "confirmed" | "risk_flag" | "indirect",
  "description": "подробное описание (до 500 символов)",
  "legal_basis": "применимые нормы закона (до 200 символов)",
  "recommendation": "рекомендация по устранению (до 300 символов)"
}

Поле evidence_status — это уровень уверенности, который аудитор указал в поле
"Статус:" исходного текста. Сопоставляй так:
- "Подтверждённое нарушение" → "confirmed"
- "Признак риска"            → "risk_flag"
- "Косвенный признак"        → "indirect"
Если статус явно не указан в тексте — определи наиболее вероятный по формулировкам
(например "возможный риск", "требует проверки", "не исключено что" указывают на
"risk_flag" или "indirect"). При сомнении используй "risk_flag" — никогда не
выбирай "confirmed", если нет явной формулировки об однозначном подтверждении.

Если нарушений нет — верни пустой массив: []`,
      messages: [{
        role:    "user",
        content: `Извлеки все нарушения из этого аудиторского текста:\n\n${assistantText.slice(0, 12000)}`,
      }],
    });

    const rawJson = extractRes.content[0].type === "text"
      ? extractRes.content[0].text.trim()
      : "[]";

    let findings: any[] = [];
    try {
      // Strip ALL markdown fences — Claude sometimes ignores instructions
      const clean = rawJson
        .replace(/^```(?:json)?\s*/im, "")  // opening fence
        .replace(/```\s*$/im, "")            // closing fence
        .trim();
      findings = JSON.parse(clean);
      if (!Array.isArray(findings)) findings = [];
    } catch (parseErr) {
      // Try to extract JSON array from anywhere in the response
      const match = rawJson.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        try {
          findings = JSON.parse(match[0]);
          if (!Array.isArray(findings)) findings = [];
        } catch {
          console.warn("[chat] Failed to parse findings JSON:", rawJson.slice(0, 200));
          return;
        }
      } else {
        console.warn("[chat] Failed to parse findings JSON:", rawJson.slice(0, 200));
        return;
      }
    }

    if (findings.length === 0) return;

    const validRiskLevels      = new Set(["КРИТИЧНО", "СУЩЕСТВЕННО", "НЕСУЩЕСТВЕННО"]);
    const validEvidenceStatuses = new Set(["confirmed", "risk_flag", "indirect"]);

    const rows = findings
      .filter((f: any) => f.title && validRiskLevels.has(f.risk_level))
      .map((f: any) => ({
        session_id:      sessionId,
        client_id:       clientId,
        title:           String(f.title).slice(0, 100),
        risk_level:      f.risk_level,
        // Default to the middle tier ("risk_flag") rather than "confirmed" if
        // Haiku omits or mis-formats this field — never let a missing value
        // silently overstate certainty.
        evidence_status: validEvidenceStatuses.has(f.evidence_status) ? f.evidence_status : "risk_flag",
        description:     String(f.description    || "").slice(0, 500),
        legal_basis:     String(f.legal_basis    || "").slice(0, 200),
        recommendation:  String(f.recommendation || "").slice(0, 300),
        status:          "open",
      }));

    if (rows.length === 0) return;

    const { error } = await supabase.from("findings").insert(rows);
    if (error) {
      console.error("[chat] Failed to save findings:", error.message);
    } else {
      console.log(`[chat] Saved ${rows.length} finding(s) to DB`);

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
    console.error("[chat] extractAndSaveFindings error:", err);
    // Never throw — findings extraction is non-critical
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

    // Build system prompt: base + audit context + all file contents
    const systemPrompt = context
      ? `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext(context)}${fileSection}`
      : `${AUDIT_SYSTEM_PROMPT}${fileSection}`;

    console.log("[chat] System prompt length:", systemPrompt.length,
      "| Model:", SONNET_MODEL,
      "| Has files:", fileSection.length > 0);

    // Main audit call — Sonnet for deep legal and financial reasoning.
    // Audit reports can be long (multi-section, tables, per-month breakdowns),
    // so we raise max_tokens and auto-continue server-side if the model is
    // cut off mid-response (stop_reason === "max_tokens"), instead of making
    // the user notice the truncation and type "continue" themselves.
    const MAX_OUTPUT_TOKENS = 16000; // per-call cap (Sonnet 4.6 ceiling)
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

    do {
      const response = await anthropic.messages.create({
        model:      SONNET_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system:     systemPrompt,
        messages:   workingMessages,
      });

      const chunk = response.content[0].type === "text" ? response.content[0].text : "";
      fullText += chunk;
      stopReason = response.stop_reason;

      console.log("[chat] Sonnet call — stop_reason:", stopReason,
        "| chunk length:", chunk.length, "| total so far:", fullText.length);

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
    } while (stopReason === "max_tokens" && continuations <= MAX_CONTINUATIONS);

    if (stopReason === "max_tokens") {
      console.warn("[chat] Hit MAX_CONTINUATIONS limit — response may still be truncated");
    }

    const text = fullText;

    // Save message and extract findings in parallel
    await Promise.all([
      supabase.from("audit_messages").insert({
        session_id: sessionId,
        client_id:  clientId,
        role:       "assistant",
        content:    text,
      }),

      extractAndSaveFindings(supabase, sessionId, clientId, text),
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
