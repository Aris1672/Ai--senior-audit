import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf":                                                          "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":       "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/csv":                                                                 "csv",
  "text/xml":                                                                 "xml",
  "application/xml":                                                          "xml",
  "image/jpeg":                                                               "image",
  "image/png":                                                                "image",
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const file      = formData.get("file")      as File;
    const clientId  = formData.get("clientId")  as string;
    const sessionId = formData.get("sessionId") as string;

    // Validate inputs
    if (!file || !clientId || !sessionId) {
      return NextResponse.json(
        { error: "file, clientId и sessionId обязательны" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Файл слишком большой. Максимальный размер: 50MB" },
        { status: 400 }
      );
    }

    const fileType = ALLOWED_TYPES[file.type];
    if (!fileType) {
      return NextResponse.json(
        { error: "Неподдерживаемый формат файла. Разрешены: PDF, XLSX, DOCX, CSV, XML, JPG, PNG" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Check client is active
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

    // Upload to Supabase Storage
    const timestamp   = Date.now();
    const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${clientId}/${sessionId}/${timestamp}_${safeName}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("audit-documents")
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert:      false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        { error: "Ошибка загрузки файла в хранилище" },
        { status: 500 }
      );
    }

    // Create document record in DB
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
      console.error("DB insert error:", dbError);
      return NextResponse.json(
        { error: "Ошибка сохранения записи о документе" },
        { status: 500 }
      );
    }

    // Log usage event
    await supabase.from("usage_events").insert({
      client_id:  clientId,
      session_id: sessionId,
      event_type: "document_upload",
      metadata: {
        file_name: file.name,
        file_type: fileType,
        file_size: file.size,
      },
    });

    return NextResponse.json({
      documentId:  doc.id,
      storagePath,
      fileType,
      status:      "processing",
      message:     "Файл загружен и поставлен в очередь на обработку",
    });

  } catch (err) {
    console.error("upload route error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}