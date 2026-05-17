/**
 * app/api/auth/login/route.ts
 *
 * Handles login server-side on Vercel.
 * Browser → Vercel → Supabase (never direct from Russia)
 */

import { createClient } from "@supabase/supabase-js";
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

    // Sign in via Supabase Auth — runs on Vercel, not in Russia
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const { data, error: authError } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !data.user || !data.session) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 }
      );
    }

    // Get profile via admin client
    const supabase = createAdminClient();
    const { data: profile } = await supabase
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

    // Set auth cookies so the session persists in the browser
    const res = NextResponse.json({
      role:        profile?.role || "client",
      companyName: profile?.company_name || "",
    });

    // Set Supabase session cookies
    const { access_token, refresh_token } = data.session;
    const cookieOptions = {
      httpOnly: false, // must be readable by Supabase client
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path:     "/",
      maxAge:   60 * 60 * 24 * 7, // 7 days
    };

    res.cookies.set("sb-access-token",  access_token,  cookieOptions);
    res.cookies.set("sb-refresh-token", refresh_token, cookieOptions);

    return res;

  } catch (err) {
    console.error("[login] error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
