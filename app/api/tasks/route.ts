import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { error: ensureError } = await supabase.rpc("ensure_user_missions", { p_profile_id: profile.id });
  if (ensureError) return NextResponse.json({ error: ensureError.message }, { status: 500 });

  const missionResult = await supabase
    .from("user_missions_view")
    .select("mission_id,key,period,title,description,reward,target,progress,claimed,action_type,sort_order")
    .eq("profile_id", profile.id)
    .neq("key", "daily_game_3")
    .order("sort_order", { ascending: true });

  if (missionResult.error) return NextResponse.json({ error: missionResult.error.message }, { status: 500 });

  return NextResponse.json({
    missions: (missionResult.data || []).map((mission) => ({
      id: mission.mission_id,
      key: mission.key,
      period: mission.period,
      title: mission.title,
      description: mission.description,
      reward: Number(mission.reward),
      target: Number(mission.target),
      progress: Number(mission.progress),
      claimed: Boolean(mission.claimed),
      actionType: mission.action_type,
    })),
  });
}
