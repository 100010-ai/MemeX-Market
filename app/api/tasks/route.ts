import { apiFailure, isDatabaseSchemaError, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, nonEmptyId, nullableText, text } from "@/lib/safe-data";
import { getMainChannelTaskState, MAIN_CHANNEL_MISSION_KEY, MAIN_CHANNEL_URL, verifyMainChannelMembership } from "@/lib/telegram-membership";

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { error: ensureError } = await supabase.rpc("ensure_user_missions", { p_profile_id: profile.id });
  if (ensureError) return apiFailure(ensureError, "Не удалось подготовить задания");

  let channelState: Awaited<ReturnType<typeof verifyMainChannelMembership>> | null = null;
  try {
    channelState = await verifyMainChannelMembership(profile);
  } catch (error) {
    if (isDatabaseSchemaError(error)) return apiFailure(error, "Не удалось подготовить проверку подписки");
    console.warn("channel membership refresh skipped", error);
    try { channelState = await getMainChannelTaskState(String(profile.id)); }
    catch (stateError) {
      if (isDatabaseSchemaError(stateError)) return apiFailure(stateError, "Не удалось загрузить состояние подписки");
      console.warn("channel membership state unavailable", stateError);
    }
  }

  const missionResult = await supabase
    .from("user_missions_view")
    .select("mission_id,key,period,title,description,reward,target,progress,claimed,action_type,sort_order")
    .eq("profile_id", profile.id)
    .neq("key", "daily_game_3")
    .order("sort_order", { ascending: true });

  if (missionResult.error) return apiFailure(missionResult.error, "Не удалось выполнить запрос");

  const missionRows = (missionResult.data || []) as Array<Record<string, unknown>>;
  return NextResponse.json({
    missions: missionRows.flatMap((mission: Record<string, unknown>) => {
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
        actionUrl: key === MAIN_CHANNEL_MISSION_KEY ? MAIN_CHANNEL_URL : null,
        membershipStatus: key === MAIN_CHANNEL_MISSION_KEY ? (channelState?.member ? "member" : channelState ? "not_member" : "unknown") : null,
        rewardRevoked: key === MAIN_CHANNEL_MISSION_KEY ? Boolean(channelState?.revokedAt) : false,
        clawbackDue: key === MAIN_CHANNEL_MISSION_KEY ? Math.max(0, finiteNumber(channelState?.clawbackDue)) : 0,
      }];
    }),
  });
}
export const GET = withApiErrors("app/api/tasks/route.ts:GET", GETHandler);
