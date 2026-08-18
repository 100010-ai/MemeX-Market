import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { missionId } = await request.json();
  if (!missionId) return NextResponse.json({ error: "Mission is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("claim_mission", { p_profile_id: profile.id, p_mission_id: missionId });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ result: data });
}
