import { apiFailure, publicBusinessError, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { MAIN_CHANNEL_MISSION_KEY, MAIN_CHANNEL_URL, verifyMainChannelMembership } from "@/lib/telegram-membership";

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "mission-claim", String(profile.id), 30, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = body.action == null ? "claim" : body.action === "claim" || body.action === "claim_all" ? body.action : null;
  if (!action) return NextResponse.json({ error: "Некорректное действие с заданием" }, { status: 400 });
  const supabase = getSupabaseAdmin();

  if (action === "claim_all") {
    const snapshot = await supabase
      .from("user_missions_view")
      .select("mission_id,key,target,progress,claimed")
      .eq("profile_id", profile.id)
      .limit(120);
    if (snapshot.error) return apiFailure(snapshot.error, "Не удалось проверить задания");
    const ready = (snapshot.data || []).filter((row) => !row.claimed && Number(row.target) > 0 && Number(row.progress) >= Number(row.target));
    let membershipChecked = false;
    let membershipAllowed = false;
    let claimedCount = 0;
    const failed: Array<{ missionId: string; reason: string }> = [];

    for (const row of ready) {
      const missionId = String(row.mission_id || "").trim();
      if (!missionId) continue;
      if (String(row.key || "") === MAIN_CHANNEL_MISSION_KEY) {
        if (!membershipChecked) {
          membershipChecked = true;
          try {
            const membership = await verifyMainChannelMembership(profile, { force: true });
            membershipAllowed = membership.member && !membership.revokedAt;
          } catch {
            membershipAllowed = false;
          }
        }
        if (!membershipAllowed) {
          failed.push({ missionId, reason: "Подписка на канал не подтверждена" });
          continue;
        }
      }
      const result = await supabase.rpc("claim_mission", { p_profile_id: profile.id, p_mission_id: missionId });
      if (result.error) failed.push({ missionId, reason: publicBusinessError(result.error, "Награда недоступна") });
      else claimedCount += 1;
    }

    return NextResponse.json({ claimedCount, failedCount: failed.length, failed });
  }

  const missionId = typeof body.missionId === "string" ? body.missionId.trim() : "";
  if (!missionId) return NextResponse.json({ error: "Не указано задание" }, { status: 400 });
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
  if (error) return NextResponse.json({ error: publicBusinessError(error, "Не удалось получить награду") }, { status: 400 });
  return NextResponse.json({ result: data });
}
export const POST = withApiErrors("app/api/tasks/claim/route.ts:POST", POSTHandler);
