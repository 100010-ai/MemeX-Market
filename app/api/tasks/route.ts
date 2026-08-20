import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function missingSponsoredSchema(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42P01" || /sponsored_campaigns|sponsored_task_claims|schema cache/i.test(error.message || "")));
}

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

  const sponsored: Array<Record<string, unknown>> = [];

  return NextResponse.json({
    missions: (missionResult.data || []).map((m) => ({
      id: m.mission_id,
      key: m.key,
      period: m.period,
      title: m.title,
      description: m.description,
      reward: Number(m.reward),
      target: Number(m.target),
      progress: Number(m.progress),
      claimed: Boolean(m.claimed),
      actionType: m.action_type,
    })),
    sponsored,
  });
}
