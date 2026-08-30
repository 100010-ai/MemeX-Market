import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const targetId = request.nextUrl.searchParams.get("profileId") || "";
  if (!validUuidLike(targetId)) return NextResponse.json({ error: "Некорректный профиль" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const [following, followers, followingCount] = await Promise.all([
    supabase.from("profile_follows_v200").select("following_profile_id").eq("follower_profile_id", profile.id).eq("following_profile_id", targetId).maybeSingle(),
    supabase.from("profile_follows_v200").select("follower_profile_id", { count: "exact", head: true }).eq("following_profile_id", targetId),
    supabase.from("profile_follows_v200").select("following_profile_id", { count: "exact", head: true }).eq("follower_profile_id", targetId),
  ]);
  const error = following.error || followers.error || followingCount.error;
  if (error) return apiFailure(error, "Не удалось загрузить подписки");
  return NextResponse.json({ following: Boolean(following.data), followers: followers.count || 0, followingCount: followingCount.count || 0 }, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "social-follow", String(profile.id), 60, 60))) return NextResponse.json({ error: "Слишком много действий" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const targetId = typeof body.profileId === "string" ? body.profileId : "";
  const enabled = body.enabled === true;
  if (!validUuidLike(targetId) || targetId === String(profile.id)) return NextResponse.json({ error: "Некорректный профиль" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const target = await supabase.from("profiles").select("id,is_system,is_banned,banned_until").eq("id", targetId).maybeSingle();
  if (target.error) return apiFailure(target.error, "Не удалось проверить профиль");
  if (!target.data || target.data.is_system) return NextResponse.json({ error: "Профиль недоступен" }, { status: 404 });
  const result = enabled
    ? await supabase.from("profile_follows_v200").upsert({ follower_profile_id: profile.id, following_profile_id: targetId }, { onConflict: "follower_profile_id,following_profile_id" })
    : await supabase.from("profile_follows_v200").delete().eq("follower_profile_id", profile.id).eq("following_profile_id", targetId);
  if (result.error) return apiFailure(result.error, "Не удалось изменить подписку", 400);
  return NextResponse.json({ following: enabled }, { headers: { "cache-control": "no-store" } });
}
export const GET = withApiErrors("app/api/social/follow/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/social/follow/route.ts:POST", POSTHandler);
