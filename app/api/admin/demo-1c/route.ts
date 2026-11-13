/**
 * app/api/admin/demo-1c — the demo 1C base switch (lib/demo-1c.ts).
 *
 * GET  -> { ready, enabled, path, base, username, password }
 *         any signed-in user: the new-audit wizard offers "fill in the demo
 *         base" while it is on. The login and password are the demo base's
 *         own (invented data), not a secret.
 * POST { enabled: boolean } -> { ok, enabled }   admins only
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { getAuthUser } from "@/lib/doc-billing-server";
import { demo1cEnabled, demo1cSchemaReady, setDemo1c, DEMO_PATH, DEMO_BASE_NAME, DEMO_USER, DEMO_PASSWORD } from "@/lib/demo-1c";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Требуется вход в систему" }, { status: 401 });
  const supabase = createAdminClient();
  const ready = await demo1cSchemaReady(supabase);
  const enabled = ready && await demo1cEnabled(supabase);
  return NextResponse.json({
    ready, enabled, path: DEMO_PATH, base: DEMO_BASE_NAME,
    ...(enabled ? { username: DEMO_USER, password: DEMO_PASSWORD } : {}),
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Требуется вход в систему" }, { status: 401 });
  const supabase = createAdminClient();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Только для администратора" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled: true | false" }, { status: 400 });
  const r = await setDemo1c(supabase, body.enabled, user.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
