/**
 * app/api/auth/login/route.ts
 *
 * Handles login server-side on Vercel.
 * Browser → Vercel → Supabase (never direct from Russia)
 */

import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email и пароль обязательны" },
        { status: 400 }
      );
    }

    // We need a mutable response to collect cookies from the SSR client
    const cookieRes = new NextResponse();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name) { return req.cookies.get(name)?.value; },
          set(name, value, options) { cookieRes.cookies.set({ name, value, ...options }); },
          remove(name, options) { cookieRes.cookies.set({ name, value: "", ...options }); },
        },
      }
    );

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !data.user) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 }
      );
    }

    // Get profile via admin client
    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role, status, company_name")
      .eq("id", data.user.id)
      .single();

    if (profile?.status === "paused") {
      return NextResponse.json(
        { error: "Ваш аккаунт приостановлен. Обратитесь к администратору." },
        { status: 403 }
      );
    }

    // Build final response with role info
    const finalRes = NextResponse.json({
      role:        profile?.role || "client",
      companyName: profile?.company_name || "",
    });

    // Copy all Supabase session cookies to the final response
    cookieRes.cookies.getAll().forEach(cookie => {
      finalRes.cookies.set(cookie);
    });

    return finalRes;

  } catch (err) {
    console.error("[login] error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
