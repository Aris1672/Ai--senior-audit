/**
 * app/api/upload/route.ts
 *
 * Uploads a file to Supabase Storage (Vercel → Supabase),
 * creates a documents record, then fires a background parse
 * for xlsx / csv / xml so the row count is ready by the time
 * the client calls /api/audit/calculate-price.
 */

import { createAdminClient } from "@/lib/supabase-server";
import { parseFile } from "@/lib/file-parser";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_TYPES: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv":         "csv",
  "text/xml":         "xml",
  "application/xml":  "xml",
  "application/pdf":  "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg":       "image",
  "image/png":        "image",
};

const PARSEABLE = new Set(["xlsx", "csv", "xml"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const file      = formData.get("file")      as File;
    const clientId  = formData.get("clientId")  as string;
    const sessionId = formData.get("sessionId") as string;

    if (!file || !clientId || !sessionId) {
      return NextResponse.json(
        { error: "file, clientId и sessionId обязательны" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Файл слишком большой. Максимальный размер: 50 МБ" },
        { status: 400 }
      );
    }

    const fileType = ALLOWED_TYPES[file.type];
    if (!fileType) {
      return NextResponse.json(
        { error: "Неподдерживаемый формат. Разрешены: PDF, XLSX, DOCX, CSV, XML, JPG, PNG" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

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

    // ── Upload to Supabase Storage (Vercel → Supabase) ────────────────────
    const timestamp   = Date.now();
    const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${clientId}/${sessionId}/${timestamp}_${safeName}`;
    const arrayBuffer = await file.arrayBuffer();

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

    // ── Background parse (xlsx / csv / xml only) ──────────────────────────
    // We already have the arrayBuffer in memory — parse directly without
    // another HTTP hop. Run after response is returned using waitUntil-style
    // fire-and-forget (no await).
    if (PARSEABLE.has(fileType)) {
      parseFile(arrayBuffer, fileType as "xlsx" | "csv" | "xml")
        .then((result) =>
          supabase
            .from("documents")
            .update({ parsed_data: result, status: "ready" })
            .eq("id", doc.id)
        )
        .catch((err) => console.error("[upload] background parse error:", err));
    }

    return NextResponse.json({
      documentId:  doc.id,
      storagePath,
      fileType,
      parseable:   PARSEABLE.has(fileType),
      status:      PARSEABLE.has(fileType) ? "processing" : "ready",
      message:     PARSEABLE.has(fileType)
        ? "Файл загружен, выполняется подсчёт строк…"
        : "Файл успешно загружен",
    });

  } catch (err) {
    console.error("[upload] route error:", err);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
