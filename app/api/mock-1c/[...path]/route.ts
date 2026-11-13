/**
 * app/api/mock-1c/[...path] — the demo 1C base over HTTP (OData, read only).
 *
 *   GET /api/mock-1c/mock/odata/standard.odata/<object>?$format=json…
 *
 * Answers only while an admin has the demo switched on (page «Демо 1С»);
 * otherwise 404. Invented data only — see services/mock-1c/README.md and
 * lib/demo-1c.ts. The app's own 1C reader does not come here: it calls the
 * same handler in-process.
 */
import { NextRequest } from "next/server";
import { demo1cRequest, DEMO_PATH } from "@/lib/demo-1c";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  let path: string;
  try { path = decodeURIComponent(url.pathname.slice(DEMO_PATH.length)); } catch { return new Response("Bad Request", { status: 400 }); }
  const out = await demo1cRequest(req.method, path, url.searchParams, req.headers.get("authorization"), url.origin);
  return new Response(out.body, { status: out.status, headers: { "content-type": out.contentType, DataServiceVersion: "3.0", ...(out.headers ?? {}) } });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
