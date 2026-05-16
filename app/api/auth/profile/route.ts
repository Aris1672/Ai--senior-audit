import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    const supabase   = createAdminClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", userId)
      .single();

    return NextResponse.json(profile);
  } catch {
    return NextResponse.json({ role: "client", status: "active" });
  }
}