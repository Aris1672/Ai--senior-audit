"use client";

import { createBrowserClient } from "@supabase/ssr";

// ─── Used in Client Components (browser-side, respects RLS) ──────────────────
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}