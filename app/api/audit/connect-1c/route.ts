/**
 * app/api/audit/connect-1c/route.ts
 *
 * Reads the audit's period from the client's 1C base (standard OData
 * interface), stores the result as a SNAPSHOT document of the audit and
 * quotes it — one operation per posted document. From there it is an
 * ordinary document: the client confirms the cost, and only then is it
 * analysed (see /api/upload for the same path with files).
 *
 * POST { sessionId, c1Config: { url, base, username, password } }
 * -> { documentId, fileName, quote, quoteText, organisation, warnings }
 *
 * The 1C password is used for this one read. It is not stored and not logged.
 * The caller must be signed in and own the audit.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { readC1Snapshot, C1Error } from "@/lib/c1-reader";
import { parseC1Snapshot, toParsedSummary } from "@/lib/file-parser";
import { quoteDocument, describeQuote } from "@/lib/doc-billing";
import { authorizeSession, isAccessError, billingSchemaReady, resolveRates, loadAcceptedContent, sha256 } from "@/lib/doc-billing-server";
import { MAX_REQUEST_CHARS } from "@/lib/volume";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { sessionId, c1Config } = await req.json();
    const supabase = createAdminClient();

    const access = await authorizeSession(supabase, sessionId);
    if (isAccessError(access)) return NextResponse.json({ error: access.error }, { status: access.status });
    const { session } = access;
    const clientId = session.client_id;

    if (session.status !== "active") {
      return NextResponse.json({ error: "Аудит завершён — подключить базу нельзя. Создайте новый аудит." }, { status: 400 });
    }
    if (!(await billingSchemaReady(supabase))) {
      return NextResponse.json({ error: "Подключение 1С недоступно: не выполнена настройка базы данных приложения. Обратитесь к администратору." }, { status: 409 });
    }
    if (!session.period_from || !session.period_to) {
      return NextResponse.json({ error: "Для подключения 1С укажите период аудита (начало и конец)." }, { status: 400 });
    }
    const cfg = {
      url: String(c1Config?.url ?? "").trim(), base: String(c1Config?.base ?? "").trim(),
      username: String(c1Config?.username ?? ""), password: String(c1Config?.password ?? ""),
    };

    let snapshot;
    try {
      snapshot = await readC1Snapshot(cfg, { from: session.period_from, to: session.period_to });
    } catch (err) {
      if (err instanceof C1Error) {
        console.warn("[1c] connect failed:", err.message, err.detail ? `| ${err.detail}` : "");
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    if (snapshot.documentCount === 0) {
      return NextResponse.json({ error: "В базе 1С нет проведённых документов за указанный период. Проверьте период аудита." }, { status: 400 });
    }
    // Never cut, never start what cannot be analysed: refuse a snapshot that is over one request.
    if (snapshot.text.length > MAX_REQUEST_CHARS * 0.9) {
      return NextResponse.json({
        error: `За выбранный период в базе ${snapshot.documentCount.toLocaleString("ru-RU")} документов — это больше, чем можно проанализировать за один запрос. ` +
               `Разделите проверку на более короткие периоды (например, по кварталам) и проведите отдельный аудит по каждому.`,
      }, { status: 400 });
    }

    // Store the snapshot like an uploaded file.
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const stamp = new Date(snapshot.takenAt);
    const p = (n: number) => String(n).padStart(2, "0");
    const fileName = `База 1С — ${snapshot.organisation.name} (снимок ${p(stamp.getUTCDate())}.${p(stamp.getUTCMonth() + 1)}.${stamp.getUTCFullYear()})`;
    const storagePath = `${clientId}/${sessionId}/1c-snapshot-${stamp.getTime()}.json`;

    const { error: storageError } = await supabase.storage.from("audit-documents")
      .upload(storagePath, bytes, { contentType: "application/json", upsert: false });
    if (storageError) {
      console.error("[1c] storage error:", storageError);
      return NextResponse.json({ error: "Не удалось сохранить данные из 1С" }, { status: 500 });
    }

    const parsed = parseC1Snapshot(buffer);
    const { data: doc, error: dbError } = await supabase.from("documents").insert({
      client_id: clientId, session_id: sessionId, file_name: fileName, file_type: "1c_odata",
      file_size: bytes.byteLength, storage_path: storagePath, status: "ready",
      parsed_data: toParsedSummary(parsed), billing_status: "pending", content_hash: sha256(buffer),
    }).select().single();
    if (dbError || !doc) {
      console.error("[1c] db error:", dbError);
      await supabase.storage.from("audit-documents").remove([storagePath]);
      return NextResponse.json({ error: "Не удалось сохранить данные из 1С" }, { status: 500 });
    }

    const rates = await resolveRates(supabase, clientId);
    if (!rates) {
      await supabase.from("documents").update({ billing_status: "declined" }).eq("id", doc.id);
      return NextResponse.json({ error: "Тариф не настроен. Обратитесь к администратору." }, { status: 500 });
    }
    const accepted = await loadAcceptedContent(supabase, sessionId, undefined, doc.id);
    const quote = quoteDocument({
      fileType: "1c_odata", parsed, sameFileAlreadyAccepted: false, knownKeys: accepted.knownKeys,
      operationRateRub: rates.operationRateRub, pageRateRub: rates.pageRateRub,
    });
    await supabase.from("documents").update({
      billing_kind: quote.kind, billing_units: quote.units, billing_new_units: quote.newUnits,
      billing_rate_rub: quote.rateRub, billing_amount_rub: quote.amountRub,
    }).eq("id", doc.id);

    await supabase.from("audit_logs").insert({
      client_id: clientId, session_id: sessionId, event_type: "document_upload",
      metadata: { file_name: fileName, file_type: "1c_odata", documents: snapshot.documentCount },
    });
    console.log("[1c] snapshot stored — documents:", snapshot.documentCount, "| chars:", snapshot.text.length, "| amount:", quote.amountRub);

    return NextResponse.json({
      documentId: doc.id, fileName, quote, quoteText: describeQuote(fileName, quote),
      organisation: snapshot.organisation, counts: snapshot.counts, warnings: snapshot.warnings,
    });

  } catch (err) {
    console.error("[1c] route error:", (err as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
