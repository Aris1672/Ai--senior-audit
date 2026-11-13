/**
 * app/api/admin/demo-1c/documents — download the demo documents (admins only).
 *
 *   GET                      -> ZIP of all documents, numbered in upload order
 *   GET ?file=<name>         -> one document
 *   GET ?list=1              -> [{ file, round, title, expect, size }]
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { zipSync } from "fflate";
import { createAdminClient } from "@/lib/supabase-server";
import { getAuthUser } from "@/lib/doc-billing-server";
import { DEMO_DOCS, demoDocPath, contentType } from "@/lib/demo-docs";

export const dynamic = "force-dynamic";

const disposition = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Требуется вход в систему" }, { status: 401 });
  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Только для администратора" }, { status: 403 });

  const url = new URL(req.url);
  if (url.searchParams.get("list")) {
    return NextResponse.json(DEMO_DOCS.map(d => {
      const p = demoDocPath(d.file);
      return { ...d, size: p ? fs.statSync(p).size : null };
    }));
  }

  const one = url.searchParams.get("file");
  if (one) {
    const p = demoDocPath(one);
    if (!p) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    return new Response(new Uint8Array(fs.readFileSync(p)), {
      headers: { "content-type": contentType(one), "content-disposition": disposition(one), "cache-control": "no-store" },
    });
  }

  const entries: Record<string, Uint8Array> = {};
  DEMO_DOCS.forEach((d, i) => {
    const p = demoDocPath(d.file);
    if (p) entries[`${i + 1}_round${d.round}_${d.file}`] = new Uint8Array(fs.readFileSync(p));
  });
  if (Object.keys(entries).length === 0) return NextResponse.json({ error: "Демо-документы не найдены на сервере" }, { status: 404 });
  const zip = zipSync(entries, { level: 6 });
  return new Response(new Uint8Array(zip), {
    headers: { "content-type": "application/zip", "content-disposition": disposition("Демо-документы_Вектор-Трейд.zip"), "cache-control": "no-store" },
  });
}
