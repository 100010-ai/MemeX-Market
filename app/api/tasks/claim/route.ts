import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { MAIN_CHANNEL_MISSION_KEY, MAIN_CHANNEL_URL, verifyMainChannelMembership } from "@/lib/telegram-membership";

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "mission-claim", String(profile.id), 30, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const missionId = typeof body.missionId === "string" ? body.missionId.trim() : "";
  if (!missionId) return NextResponse.json({ error: "Mission is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const mission = await supabase.from("missions").select("key").eq("id", missionId).eq("active", true).maybeSingle();
  if (mission.error) return apiFailure(mission.error, "Не удалось проверить задание");
  if (!mission.data) return NextResponse.json({ error: "Задание недоступно" }, { status: 404 });

  if (String(mission.data.key) === MAIN_CHANNEL_MISSION_KEY) {
    try {
      const membership = await verifyMainChannelMembership(profile, { force: true });
      if (!membership.member) {
        return NextResponse.json({
          error: "Сначала подпишитесь на официальный канал MEMEX MARKET",
          code: "CHANNEL_SUBSCRIPTION_REQUIRED",
          channelUrl: MAIN_CHANNEL_URL,
        }, { status: 409 });
      }
      if (membership.revokedAt) {
        return NextResponse.json({ error: "Награда за эту подписку уже была отозвана", code: "CHANNEL_REWARD_REVOKED" }, { status: 409 });
      }
    } catch (error) {
      return apiFailure(error, "Не удалось проверить подписку через Telegram", 503);
    }
  }

  const { data, error } = await supabase.rpc("claim_mission", { p_profile_id: profile.id, p_mission_id: missionId });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ result: data });
}
export const POST = withApiErrors("app/api/tasks/claim/route.ts:POST", POSTHandler);
