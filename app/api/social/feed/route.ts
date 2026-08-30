import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getUnifiedMarketActivity } from "@/lib/activity-feed";

function eventId(activityId: string) {
  const value = activityId.startsWith("activity-") ? activityId.slice("activity-".length) : "";
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? value : null;
}

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const mode = request.nextUrl.searchParams.get("mode") === "following" ? "following" : "all";
  const requested = Number(request.nextUrl.searchParams.get("limit") || 50);
  const limit = Number.isFinite(requested) ? Math.max(10, Math.min(80, Math.floor(requested))) : 50;
  const supabase = getSupabaseAdmin();
  try {
    const [activity, followingResult] = await Promise.all([
      getUnifiedMarketActivity(supabase, mode === "following" ? 100 : limit),
      supabase.from("profile_follows_v200").select("following_profile_id").eq("follower_profile_id", profile.id).limit(500),
    ]);
    if (followingResult.error) throw followingResult.error;
    const followingIds = new Set((followingResult.data || []).map((row) => String(row.following_profile_id)));
    const selected = (mode === "following" ? activity.filter((item) => item.actorId && followingIds.has(item.actorId)) : activity).slice(0, limit);
    const ids = selected.map((item) => eventId(item.id)).filter((value): value is string => Boolean(value));
    const reactionsResult = ids.length
      ? await supabase.rpc("social_feed_reactions_v200", { p_profile_id: profile.id, p_event_ids: ids })
      : { data: {}, error: null };
    if (reactionsResult.error) throw reactionsResult.error;
    const reactions = reactionsResult.data && typeof reactionsResult.data === "object" && !Array.isArray(reactionsResult.data) ? reactionsResult.data as Record<string, unknown> : {};
    return NextResponse.json({
      mode,
      activity: selected.map((item) => {
        const id = eventId(item.id);
        const reaction = id && reactions[id] && typeof reactions[id] === "object" ? reactions[id] as Record<string, unknown> : {};
        return { ...item, eventId: id, followingActor: Boolean(item.actorId && followingIds.has(item.actorId)), reactions: { fire: Number(reaction.fire || 0), eyes: Number(reaction.eyes || 0), diamond: Number(reaction.diamond || 0), viewerReaction: typeof reaction.viewerReaction === "string" ? reaction.viewerReaction : null } };
      }),
      followingCount: followingIds.size,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error, "Не удалось загрузить социальную ленту"); }
}
export const GET = withApiErrors("app/api/social/feed/route.ts:GET", GETHandler);
