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
    // 1. Find document linked to this audit session
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("storage_path, file_name, file_type, row_count")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (docErr || !doc?.storage_path) return null;

    // 2. Download file bytes from Supabase Storage
    //    createAdminClient uses the SERVICE_ROLE key — bypasses RLS
    const { data: blob, error: dlErr } = await supabase
      .storage
      .from("audit-documents")
      .download(doc.storage_path);

    if (dlErr || !blob) {
      console.error("[chat] Storage download failed:", dlErr);
      return `[Документ: ${doc.file_name}, строк: ${doc.row_count ?? "?"} — файл недоступен]`;
    }

    // 3. Convert Blob → ArrayBuffer → parse
    const arrayBuffer = await blob.arrayBuffer();

    // Detect file type from name or stored type
    const ext = doc.file_name?.split(".").pop()?.toLowerCase();
    const fileType =
      ext === "csv" ? "csv"
      : ext === "xml" ? "xml"
      : "xlsx"; // default to xlsx for .xlsx / .xls / unknown

    const parsed = await parseFile(arrayBuffer, fileType);

    if (!parsed.textContent) {
      return `[Документ: ${doc.file_name}, строк: ${parsed.rowCount}. Содержимое не извлечено.]`;
    }

    // 4. Build a labelled block for the system prompt
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
    console.error("[chat] getDocumentTextContent error:", err);
    return null;
  }
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { messages, sessionId, clientId, context } = await req.json();

    if (!clientId || !messages) {
      return NextResponse.json(
        { error: "clientId и messages обязательны" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Check client is active before every AI call
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

    // Fetch and parse the uploaded document (if session has one)
    let fileSection = "";
    if (sessionId) {
      const fileContent = await getDocumentTextContent(supabase, sessionId);
      if (fileContent) {
        fileSection = `\n\n${fileContent}`;
      }
    }

    // Build system prompt: base + audit context + file content
    const systemPrompt = context
      ? `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext(context)}${fileSection}`
      : `${AUDIT_SYSTEM_PROMPT}${fileSection}`;

    // Call Claude Haiku 4.5 via Vercel — never directly from Russia
    const response = await anthropic.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 2048,
      system:     systemPrompt,
      messages,
    });

    const text      = response.content[0].type === "text" ? response.content[0].text : "";
    const tokensIn  = response.usage.input_tokens;
    const tokensOut = response.usage.output_tokens;

    // Calculate cost in rubles
    const usdToRub = Number(process.env.USD_TO_RUB) || 90;
    const costRub  =
      ((tokensIn  / 1000) * HAIKU_PRICING.inputPer1K +
       (tokensOut / 1000) * HAIKU_PRICING.outputPer1K) * usdToRub;

    // Persist message + usage event + session cost in parallel
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
    console.error("chat route error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
