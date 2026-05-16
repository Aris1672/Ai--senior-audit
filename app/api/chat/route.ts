import { anthropic, AUDIT_SYSTEM_PROMPT, buildAuditContext, HAIKU_PRICING } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase-server";
import { parseFile } from "@/lib/file-parser";
import { NextRequest, NextResponse } from "next/server";

// ─── Fetch + parse the uploaded document from Supabase Storage ───────────────
async function getDocumentTextContent(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string
): Promise<string | null> {
  try {
    console.log("[chat] Looking up document for sessionId:", sessionId);

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("storage_path, file_name, file_type, page_count")
      .eq("session_id", sessionId)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .single();

    if (docErr) {
      console.error("[chat] Document lookup error:", docErr.message);
      return null;
    }
    if (!doc?.storage_path) {
      console.warn("[chat] No document found for session:", sessionId);
      return null;
    }

    console.log("[chat] Found document:", doc.file_name, "at path:", doc.storage_path);

    // Download file bytes from Supabase Storage via service role
    const { data: blob, error: dlErr } = await supabase
      .storage
      .from("audit-documents")
      .download(doc.storage_path);

    if (dlErr || !blob) {
      console.error("[chat] Storage download failed:", dlErr?.message);
      return `[Документ: ${doc.file_name} — ошибка загрузки: ${dlErr?.message}]`;
    }

    console.log("[chat] Downloaded blob size:", blob.size, "bytes");

    const arrayBuffer = await blob.arrayBuffer();

    // Detect file type from extension
    const ext = doc.file_name?.split(".").pop()?.toLowerCase();
    const fileType =
      ext === "csv" ? "csv"
      : ext === "xml" ? "xml"
      : "xlsx";

    console.log("[chat] Parsing as:", fileType);

    const parsed = await parseFile(arrayBuffer, fileType);

    console.log("[chat] Parse result — rowCount:", parsed.rowCount,
      "textContent length:", parsed.textContent?.length ?? 0);

    if (!parsed.textContent) {
      return `[Документ: ${doc.file_name}, строк: ${parsed.rowCount}. Содержимое не извлечено.]`;
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

    return `=== ЗАГРУЖЕННЫЙ ФИНАНСОВЫЙ ДОКУМЕНТ ===\n${header}\n\n${parsed.textContent}\n=== КОНЕЦ ДОКУМЕНТА ===`;

  } catch (err) {
    console.error("[chat] getDocumentTextContent exception:", err);
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

    // Fetch and parse the uploaded document
    let fileSection = "";
    if (sessionId) {
      const fileContent = await getDocumentTextContent(supabase, sessionId);
      if (fileContent) {
        fileSection = `\n\n${fileContent}`;
        console.log("[chat] File content added to prompt, length:", fileContent.length);
      } else {
        console.warn("[chat] No file content retrieved for session:", sessionId);
      }
    } else {
      console.warn("[chat] No sessionId provided — skipping file lookup");
    }

    // Build system prompt
    const systemPrompt = context
      ? `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext(context)}${fileSection}`
      : `${AUDIT_SYSTEM_PROMPT}${fileSection}`;

    console.log("[chat] System prompt length:", systemPrompt.length,
      "| Has file:", fileSection.length > 0);

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
