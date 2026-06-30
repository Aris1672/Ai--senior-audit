/**
 * app/api/auth/logout/route.ts
 *
 * Handles logout server-side on Vercel.
 * Browser → Vercel → Supabase (never direct from Russia)
 *
 * Required by the updated app/admin/layout.tsx and app/client/layout.tsx —
 * both now call this instead of using a client-side Supabase client.
 */

import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const cookieRes = new NextResponse(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return req.cookies.get(name)?.value; },
          set(name: string, value: string, options: any) { cookieRes.cookies.set({ name, value, ...options }); },
          remove(name: string, options: any) { cookieRes.cookies.set({ name, value: "", ...options }); },
        },
      }
    );

    await supabase.auth.signOut();

    return cookieRes;
  } catch (err) {
    console.error("[logout] error:", err);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
