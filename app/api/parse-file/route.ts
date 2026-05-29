/**
 * app/api/parse-file/route.ts
 *
 * Downloads a file from Supabase Storage (via Vercel → Supabase),
 * counts transaction rows, caches the result in documents.parsed_data.
 *
 * POST { documentId: string }
 * → { documentId, rowCount, parseMethod, sheetName?, detectedColumns?, xmlElement?, c1AccountSummary? }
 */

import { createAdminClient } from "@/lib/supabase-server";
import { parseFile, is1CClientBankExchange, type ParseResult } from "@/lib/file-parser";
import { NextRequest, NextResponse } from "next/server";

const PARSEABLE = new Set(["xlsx", "csv", "xml", "xls", "docx", "doc", "1c_txt"]);

export async function POST(req: NextRequest) {
  try {
    const { documentId } = await req.json();

    if (!documentId) {
      return NextResponse.json(
        { error: "documentId обязателен" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // ── Fetch document record ─────────────────────────────────────────────
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id, file_type, storage_path, status, parsed_data")
      .eq("id", documentId)
      .single();

    if (docErr || !doc) {
      return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
    }

    // ── Return cached result if already parsed ────────────────────────────
    if (doc.status === "ready" && doc.parsed_data?.rowCount != null) {
      const p: ParseResult = doc.parsed_data;
      return NextResponse.json({
        documentId:       doc.id,
        rowCount:         p.rowCount,
        parseMethod:      p.parseMethod,
        sheetName:        p.sheetName,
        detectedColumns:  p.detectedColumns,
        xmlElement:       p.xmlElement,
        c1AccountSummary: p.c1AccountSummary,
      });
    }

    if (!PARSEABLE.has(doc.file_type)) {
      return NextResponse.json(
        { error: `Подсчёт строк не поддерживается для типа: ${doc.file_type}` },
        { status: 400 }
      );
    }

    // ── Download from Supabase Storage (Vercel → Supabase) ───────────────
    const { data: blob, error: dlErr } = await supabase.storage
      .from("audit-documents")
      .download(doc.storage_path);

    if (dlErr || !blob) {
      console.error("[parse-file] storage download error:", dlErr);
      await supabase
        .from("documents")
        .update({ status: "error" })
        .eq("id", documentId);
      return NextResponse.json(
        { error: "Не удалось загрузить файл из хранилища" },
        { status: 500 }
      );
    }

    // ── Parse ─────────────────────────────────────────────────────────────
    const buffer   = await blob.arrayBuffer();

    // Re-verify 1C files in case the stored file_type is the legacy "txt"
    const fileType = doc.file_type === "txt" && is1CClientBankExchange(buffer)
      ? "1c_txt"
      : doc.file_type as "xlsx" | "xls" | "csv" | "xml" | "docx" | "doc" | "1c_txt";

    const result   = await parseFile(buffer, fileType);

    // ── Cache result in documents table ───────────────────────────────────
    await supabase
      .from("documents")
      .update({ parsed_data: result, status: "ready" })
      .eq("id", documentId);

    return NextResponse.json({
      documentId:       doc.id,
      rowCount:         result.rowCount,
      parseMethod:      result.parseMethod,
      sheetName:        result.sheetName,
      detectedColumns:  result.detectedColumns,
      xmlElement:       result.xmlElement,
      c1AccountSummary: result.c1AccountSummary,
    });

  } catch (err) {
    console.error("[parse-file] error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера при разборе файла" },
      { status: 500 }
    );
  }
}
