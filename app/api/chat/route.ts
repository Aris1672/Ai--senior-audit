import { anthropic, AUDIT_SYSTEM_PROMPT, buildAuditContext, HAIKU_PRICING } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

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

    // Build system prompt with session context if provided
    const systemPrompt = context
      ? `${AUDIT_SYSTEM_PROMPT}\n\n${buildAuditContext(context)}`
      : AUDIT_SYSTEM_PROMPT;

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
    const usdToRub  = Number(process.env.USD_TO_RUB) || 90;
    const costRub   = ((tokensIn  / 1000 * HAIKU_PRICING.inputPer1K) +
                       (tokensOut / 1000 * HAIKU_PRICING.outputPer1K)) * usdToRub;

    // Persist message + usage event + session cost in parallel
    await Promise.all([
      // Save assistant message
      supabase.from("audit_messages").insert({
        session_id: sessionId,
        client_id:  clientId,
        role:       "assistant",
        content:    text,
        tokens_in:  tokensIn,
        tokens_out: tokensOut,
      }),

      // Log usage event
      supabase.from("usage_events").insert({
        client_id:  clientId,
        session_id: sessionId,
        event_type: "ai_message",
        tokens_in:  tokensIn,
        tokens_out: tokensOut,
        cost_rub:   costRub,
      }),

      // Update session running cost
      supabase.rpc("increment_session_cost", {
        p_session_id: sessionId,
        p_amount:     costRub,
      }),
    ]);

    return NextResponse.json({
      message:   text,
      tokensIn,
      tokensOut,
      costRub:   Math.round(costRub * 100) / 100,
    });

  } catch (err) {
    console.error("chat route error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}