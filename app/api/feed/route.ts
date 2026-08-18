import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getMarketActivity } from "@/lib/feed";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const activity = await getMarketActivity(getSupabaseAdmin(), 50);
    return NextResponse.json({ activity });
  } catch (error) {
    console.error("feed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load market feed" }, { status: 500 });
  }
}
