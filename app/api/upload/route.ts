/**
 * app/api/upload/route.ts
 *
 * Uploads a file to storage, creates a documents record, reads the file and
 * QUOTES it (Nov 2026): operations × rate, or pages × rate — computed here on
 * the server. The document is stored as "pending" and is not analysed until
 * the client confirms the quote (/api/billing/confirm-documents). This is the
 * same for the first file of an audit and for files added later in the chat.
 *
 * Scans and photos (Nov 13, 2026): a JPG / PNG, or a PDF without a text
 * layer, is sent to our own recognition service (lib/ocr-client.ts) here, once.
 * The result is stored beside the file (`<path>.ocr.json`) and read from there
 * by every later turn; only pages recognised reliably are analysed and charged.
 *
 * The caller must be signed in and own the audit; the client id is taken
 * from the audit, not from the request.
 */

import { createAdminClient } from "@/lib/supabase-server";
import { parseFile, is1CClientBankExchange, toParsedSummary } from "@/lib/file-parser";
import { NextRequest, NextResponse } from "next/server";
import { quoteDocument, describeQuote, type DocumentQuote } from "@/lib/doc-billing";
import { recognizeDocument, OCR_ENABLED, OcrUnavailableError } from "@/lib/ocr-client";
import { buildStoredOcr, minConfidenceFromEnv, ocrParseResult, ocrSidecarPath, ocrCounts } from "@/lib/ocr";
import {
  authorizeSession, isAccessError, billingSchemaReady, resolveRates, loadAcceptedContent, sha256,
} from "@/lib/doc-billing-server";

const ALLOWED_TYPES: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv":         "csv",
  "text/xml":         "xml",
  "application/xml":  "xml",
  "application/pdf":  "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg":       "image",
  "image/png":        "image",
  "application/vnd.ms-excel": "xls",
  "application/msword":      "doc",
  // 1C bank exchange — banks export as plain text, MIME is often text/plain
  "text/plain":       "txt",
};

const PARSEABLE = new Set(["xlsx", "xls", "csv", "xml", "docx", "doc", "pdf","1c_txt"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const file      = formData.get("file")      as File;
    const sessionId = formData.get("sessionId") as string;

    if (!file || !sessionId) {
      return NextResponse.json(
        { error: "file и sessionId обязательны" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // ── Who is asking, and is it their audit ──────────────────────────────
    const access = await authorizeSession(supabase, sessionId);
    if (isAccessError(access)) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const clientId = access.session.client_id;
    const session  = access.session;

    if (session.status !== "active") {
      return NextResponse.json(
        { error: "Аудит завершён, стоимость зафиксирована — добавить документы нельзя. Создайте новый аудит." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Файл слишком большой. Максимальный размер: 50 МБ" },
        { status: 400 }
      );
    }

    // Determine fileType from MIME; for plain text we sniff content below
    let fileType = ALLOWED_TYPES[file.type];
    if (!fileType) {
      return NextResponse.json(
        { error: "Неподдерживаемый формат. Разрешены: PDF, XLSX, XLS, DOCX, DOC, CSV, XML, TXT (1C), JPG, PNG" },
        { status: 400 }
      );
    }

    // ── Check client is active ────────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", clientId)
      .single();

    if (!profile || profile.status !== "active") {
      return NextResponse.json(
        { error: "Аккаунт приостановлен или не найден." },
        { status: 403 }
      );
    }

    // ── Look up the audit period for this session ─────────────────────────
    // Read once here so the background parse below counts/extracts rows
    // scoped to the client's selected audit period, not the whole file —
    // same period_from/period_to written by create_audit_session, single
    // source of truth (see PROJECT_STATUS.md period-filtering fix).
    const period = { dateFrom: session.period_from ?? undefined, dateTo: session.period_to ?? undefined };

    // ── Upload to Supabase Storage (Vercel → Supabase) ────────────────────
    const timestamp   = Date.now();
    const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${clientId}/${sessionId}/${timestamp}_${safeName}`;
    const arrayBuffer = await file.arrayBuffer();

    // ── Sniff 1C format: text/plain files are re-classified if they start with
    //    the "1CClientBankExchange" magic string. Done after reading arrayBuffer
    //    so we only read the file once.
    if (fileType === "txt") {
      fileType = is1CClientBankExchange(arrayBuffer) ? "1c_txt" : "txt";
      if (fileType === "txt") {
        return NextResponse.json(
          { error: "Текстовый файл не является форматом 1CClientBankExchange. Убедитесь, что файл выгружен из банка в формате 1C." },
          { status: 400 }
        );
      }
    }

    const { error: uploadError } = await supabase.storage
      .from("audit-documents")
      .upload(storagePath, arrayBuffer, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("[upload] storage error:", uploadError);
      return NextResponse.json(
        { error: "Ошибка загрузки файла в хранилище" },
        { status: 500 }
      );
    }

    const billingReady = await billingSchemaReady(supabase);
    const contentHash  = sha256(arrayBuffer);

    // ── Create document record ────────────────────────────────────────────
    const { data: doc, error: dbError } = await supabase
      .from("documents")
      .insert({
        client_id:    clientId,
        session_id:   sessionId,
        file_name:    file.name,
        file_type:    fileType,
        file_size:    file.size,
        storage_path: storagePath,
        status:       "processing",
        ...(billingReady ? { billing_status: "pending", content_hash: contentHash } : {}),
      })
      .select()
      .single();

    if (dbError || !doc) {
      console.error("[upload] db insert error:", dbError);
      return NextResponse.json(
        { error: "Ошибка сохранения записи о документе" },
        { status: 500 }
      );
    }

    // ── Log usage event ───────────────────────────────────────────────────
    await supabase.from("usage_events").insert({
      client_id:  clientId,
      session_id: sessionId,
      event_type: "document_upload",
      metadata:   { file_name: file.name, file_type: fileType, file_size: file.size },
    });

    // ── Read the file now: the quote needs its real content ───────────────
    let parsed: Awaited<ReturnType<typeof parseFile>> | null = null;
    if (PARSEABLE.has(fileType)) {
      try {
        parsed = await parseFile(arrayBuffer, fileType as "xlsx" | "xls" | "csv" | "xml" | "docx" | "doc" | "1c_txt" | "pdf", period);
        await supabase.from("documents")
          .update({ parsed_data: toParsedSummary(parsed), status: "ready", page_count: parsed.pageCount ?? null })
          .eq("id", doc.id);
      } catch (err) {
        console.error("[upload] parse error:", err);
        await supabase.from("documents").update({ status: "error" }).eq("id", doc.id);
      }
    } else {
      await supabase.from("documents").update({ status: "ready" }).eq("id", doc.id);
    }

    // ── Scan or photo: recognise the text once, on our own server ─────────
    let ocrUnavailable = false;
    const isScan = fileType === "image" || (fileType === "pdf" && !!parsed?.likelyScanned);
    if (isScan && OCR_ENABLED) {
      try {
        const mediaType = fileType === "pdf" ? "application/pdf" : (file.type === "image/png" ? "image/png" : "image/jpeg");
        const t0 = Date.now();
        const result = await recognizeDocument(arrayBuffer, mediaType, parsed?.pageCount ?? 1);
        if (result) {
          const stored = buildStoredOcr(result.engine, result.pages, minConfidenceFromEnv());
          const { error: sideErr } = await supabase.storage
            .from("audit-documents")
            .upload(ocrSidecarPath(storagePath), new TextEncoder().encode(JSON.stringify(stored)), { contentType: "application/json", upsert: true });
          if (sideErr) throw new OcrUnavailableError(`could not store the recognised text: ${sideErr.message}`);
          parsed = ocrParseResult(stored);
          await supabase.from("documents")
            .update({ parsed_data: toParsedSummary(parsed), status: "ready", page_count: parsed.pageCount ?? null })
            .eq("id", doc.id);
          const c = ocrCounts(stored);
          // Counts only — recognised text is never logged.
          console.log(`[upload] OCR — pages: ${c.pages} | reliable: ${c.reliable} | unreliable: ${c.unreliable} | empty: ${c.empty} | ${Date.now() - t0} ms`);
        }
      } catch (err) {
        ocrUnavailable = true;
        console.error("[upload] OCR failed — document treated as unreadable:", (err as Error)?.message);
      }
    }

    // ── Quote ─────────────────────────────────────────────────────────────
    let quote: DocumentQuote | null = null;
    let quoteText: string | null = null;
    if (billingReady) {
      const rates = await resolveRates(supabase, clientId);
      if (!rates) {
        await supabase.from("documents").update({ billing_status: "declined" }).eq("id", doc.id);
        return NextResponse.json({ error: "Тариф не настроен. Обратитесь к администратору." }, { status: 500 });
      }
      const accepted = await loadAcceptedContent(supabase, sessionId, period, doc.id);
      quote = quoteDocument({
        fileType, parsed,
        sameFileAlreadyAccepted: accepted.hashes.has(contentHash),
        knownKeys: accepted.knownKeys,
        operationRateRub: rates.operationRateRub,
        pageRateRub: rates.pageRateRub,
        ocrUnavailable,
      });
      quoteText = describeQuote(file.name, quote);
      await supabase.from("documents").update({
        billing_kind:       quote.kind,
        billing_units:      quote.units,
        billing_new_units:  quote.newUnits,
        billing_rate_rub:   quote.rateRub,
        billing_amount_rub: quote.amountRub,
      }).eq("id", doc.id);
      console.log("[upload] quote —", quote.kind, "| units:", quote.units, "| new:", quote.newUnits, "| amount:", quote.amountRub);
    }

    return NextResponse.json({
      documentId:  doc.id,
      fileName:    file.name,
      fileType,
      parseable:   PARSEABLE.has(fileType),
      status:      "ready",
      // null until migration 005 has been run (old behaviour: no quote, no confirmation)
      quote,
      quoteText,
      message:     "Файл загружен",
    });

  } catch (err) {
    console.error("[upload] route error:", err);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
