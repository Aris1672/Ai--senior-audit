import { NextRequest, NextResponse } from "next/server";

// Auth is handled server-side via /api/auth/me and /api/auth/profile
// No direct Supabase calls here — all Supabase traffic goes through
// Vercel API routes to avoid Russia network restrictions.

export async function middleware(req: NextRequest) {
  return NextResponse.next();
}

// Also export as proxy for Next.js 16 compatibility
export { middleware as proxy };

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|public).*)",
  ],
};
