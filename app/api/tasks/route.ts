import { apiFailure, isDatabaseSchemaError, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, nonEmptyId, nullableText, text } from "@/lib/safe-data";
import { getMainChannelTaskState, MAIN_CHANNEL_MISSION_KEY, MAIN_CHANNEL_URL } from "@/lib/telegram-membership";
import { isInspectionSession } from "@/lib/session";

const missionEnsureCache = new Map<string, number>();

async function ensureMissions(profileId: string) {
  const now = Date.now();
  const expiresAt = missionEnsureCache.get(profileId) || 0;
  if (expiresAt > now) return null;
  const result = await getSupabaseAdmin().rpc("ensure_user_missions", { p_profile_id: profileId });
  if (!result.error) {
    missionEnsureCache.set(profileId, now + 15_000);
    if (missionEnsureCache.size > 2_000) {
      for (const [key, expiry] of missionEnsureCache) if (expiry <= now) missionEnsureCache.delete(key);
    }
  }
  return result.error;
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const inspection = await isInspectionSession();
  const ensureError = inspection ? null : await ensureMissions(String(profile.id));
  if (ensureError) return apiFailure(ensureError, "Не удалось подготовить задания");

  // Task list loading must not wait on Telegram Bot API. The membership
  // state shown here is cached server state; explicit Verify and Claim routes
  // always force a fresh getChatMember check before granting a reward.
  let channelState: Awaited<ReturnType<typeof getMainChannelTaskState>> | null = null;
  try {
    channelState = await getMainChannelTaskState(String(profile.id));
  } catch (stateError) {
    if (isDatabaseSchemaError(stateError)) return apiFailure(stateError, "Не удалось загрузить состояние подписки");
    console.warn("channel membership state unavailable", stateError);
  }

  const missionResult = await supabase
    .from("user_missions_view")
    .select("mission_id,key,period,title,description,reward,target,progress,claimed,action_type,sort_order")
    .eq("profile_id", profile.id)
    .neq("key", "daily_game_3")
    .order("sort_order", { ascending: true })
    .limit(120);

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
