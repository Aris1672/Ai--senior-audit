/**
 * app/api/billing/confirm-documents/route.ts
 *
 * The client accepts or declines the quote for documents they uploaded.
 * Accepted documents are added to the audit's recorded amount and become
 * visible to the analysis; declined ones are removed and never analysed.
 *
 * POST { sessionId, documentIds: string[], accept: boolean }
 * -> { confirmed, declined, addedRub, session: { costRub, operations, pages } }
 *
 * Amounts come from the document rows written by /api/upload — the request
 * carries no prices. The caller must be signed in and own the audit.
 */
import { createAdminClient } from "@/lib/supabase-server";
import { authorizeSession, isAccessError, billingSchemaReady, settleDocuments } from "@/lib/doc-billing-server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { sessionId, documentIds, accept } = await req.json();
    if (!Array.isArray(documentIds) || documentIds.length === 0 || documentIds.some(id => typeof id !== "string") || typeof accept !== "boolean") {
      return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const access = await authorizeSession(supabase, sessionId);
    if (isAccessError(access)) return NextResponse.json({ error: access.error }, { status: access.status });

    if (!(await billingSchemaReady(supabase))) {
      return NextResponse.json({ error: "Подтверждение стоимости ещё не настроено" }, { status: 409 });
    }
    if (accept && access.session.status !== "active") {
      return NextResponse.json(
        { error: "Аудит завершён, стоимость зафиксирована — принять новые документы нельзя." },
        { status: 400 }
      );
    }

    const result = await settleDocuments(supabase, sessionId, documentIds, accept);
    console.log("[billing] settle —", accept ? "accepted" : "declined", "| documents:", result.confirmed + result.declined,
      "| added:", result.addedRub, "| audit total:", result.session.costRub);
    return NextResponse.json(result);

  } catch (err) {
    console.error("[billing] confirm-documents error:", err);
    return NextResponse.json({ error: "Не удалось записать подтверждение" }, { status: 500 });
  }
}
