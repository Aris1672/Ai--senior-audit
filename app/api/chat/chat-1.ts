import { anthropic, AUDIT_SYSTEM_PROMPT, buildAuditContext, HAIKU_PRICING } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase-server";
import { parseFile } from "@/lib/file-parser";
import { NextRequest, NextResponse } from "next/server";

// ─── Fetch + parse ALL documents linked to this session ───────────────────────
async function getAllDocumentsContent(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string
): Promise<string | null> {
  try {
    console.log("[chat] Looking up all documents for sessionId:", sessionId);

    // Get ALL documents for this session, oldest first
    const { data: docs, error: docErr } = await supabase
      .from("documents")
      .select("storage_path, file_name, file_type, page_count")
      .eq("session_id", sessionId)
      .order("uploaded_at", { ascending: true });

    if (docErr) {
      console.error("[chat] Document lookup error:", docErr.message);
      return null;
    }
    if (!docs || docs.length === 0) {
      console.warn("[chat] No documents found for session:", sessionId);
      return null;
    }

    console.log(`[chat] Found ${docs.length} document(s) for session`);

    // Parse each document and collect content
    const sections: string[] = [];

    for (const doc of docs) {
      if (!doc.storage_path) continue;

      console.log("[chat] Downloading:", doc.file_name);

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
      const ext = doc.file_name?.split(".").pop()?.toLowerCase();
      const fileType =
        ext === "csv" ? "csv"
        : ext === "xml" ? "xml"
        : ext === "docx" ? "docx"
        : ext === "xls"  ? "xls"
        : "xlsx";

      const parsed = await parseFile(arrayBuffer, fileType as "xlsx" | "csv" | "xml" | "docx");

      console.log("[chat]", doc.file_name, "— rowCount:", parsed.rowCount,
        "textContent length:", parsed.textContent?.length ?? 0);

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

    if (sections.length === 0) return null;

    const intro = docs.length > 1
      ? `Загружено документов: ${docs.length}\n\n`
      : "";

    return intro + sections.join("\n\n");

  } catch (err) {
    console.error("[chat] getAllDocumentsContent exception:", err);
    return null;
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

    // Fetch and parse ALL uploaded documents for this session
    let fileSection = "";
    if (sessionId) {
      const fileContent = await getAllDocumentsContent(supabase, sessionId);
      if (fileContent) {
        fileSection = `\n\n=== ЗАГРУЖЕННЫЕ ФИНАНСОВЫЕ ДОКУМЕНТЫ ===\n${fileContent}\n=== КОНЕЦ ДОКУМЕНТОВ ===`;
        console.log("[chat] File section length:", fileSection.length);
      } else {
        console.warn("[chat] No file content for session:", sessionId);
      }
    }

    // Build system prompt: base + audit context + all file contents
    const systemPrompt = context
      ? `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext(context)}${fileSection}`
      : `${AUDIT_SYSTEM_PROMPT}${fileSection}`;

    console.log("[chat] System prompt length:", systemPrompt.length,
      "| Has files:", fileSection.length > 0);

    const response = await anthropic.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 2048,
      system:     systemPrompt,
      messages,
    });

    const text      = response.content[0].type === "text" ? response.content[0].text : "";
    const tokensIn  = response.usage.input_tokens;
    const tokensOut = response.usage.output_tokens;

    const usdToRub = Number(process.env.USD_TO_RUB) || 90;
    const costRub  =
      ((tokensIn  / 1000) * HAIKU_PRICING.inputPer1K +
       (tokensOut / 1000) * HAIKU_PRICING.outputPer1K) * usdToRub;

    await Promise.all([
      supabase.from("audit_messages").insert({
        session_id: sessionId,
        client_id:  clientId,
        role:       "assistant",
        content:    text,
        tokens_in:  tokensIn,
        tokens_out: tokensOut,
      }),

      supabase.from("usage_events").insert({
        client_id:  clientId,
        session_id: sessionId,
        event_type: "ai_message",
        tokens_in:  tokensIn,
        tokens_out: tokensOut,
        cost_rub:   costRub,
      }),

      supabase.rpc("increment_session_cost", {
        p_session_id: sessionId,
        p_amount:     costRub,
      }),
    ]);

    // Extract and save findings fire-and-forget (non-blocking)
    extractAndSaveFindings(supabase, sessionId, clientId, text).catch(console.error);

    return NextResponse.json({
      message:  text,
      tokensIn,
      tokensOut,
      costRub:  Math.round(costRub * 100) / 100,
    });

  } catch (err) {
    console.error("[chat] route error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
