import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, nonEmptyId, nullableText, text } from "@/lib/safe-data";

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { error: ensureError } = await supabase.rpc("ensure_user_missions", { p_profile_id: profile.id });
  if (ensureError) return apiFailure(ensureError, "Не удалось подготовить задания");

  const missionResult = await supabase
    .from("user_missions_view")
    .select("mission_id,key,period,title,description,reward,target,progress,claimed,action_type,sort_order")
    .eq("profile_id", profile.id)
    .neq("key", "daily_game_3")
    .order("sort_order", { ascending: true });

  if (missionResult.error) return apiFailure(missionResult.error, "Не удалось выполнить запрос");

  return NextResponse.json({
    missions: (missionResult.data || []).flatMap((mission) => {
      const id = nonEmptyId(mission.mission_id);
      const key = text(mission.key, "", 100);
      if (!id || !key) return [];
      return [{
        id,
        key,
        period: text(mission.period, "daily", 32),
        title: text(mission.title, "Задание", 160),
        description: text(mission.description, "", 500),
        reward: finiteNumber(mission.reward),
        target: Math.max(0, finiteNumber(mission.target)),
        progress: Math.max(0, finiteNumber(mission.progress)),
        claimed: Boolean(mission.claimed),
        actionType: nullableText(mission.action_type, 64),
      }];
    }),
  });
}
export const GET = withApiErrors("app/api/tasks/route.ts:GET", GETHandler);
