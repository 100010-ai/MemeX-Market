import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getUnifiedMarketActivity } from "@/lib/activity-feed";

const feedCache = new Map<number, { expiresAt: number; activity: Awaited<ReturnType<typeof getUnifiedMarketActivity>> }>();
const feedInFlight = new Map<number, Promise<Awaited<ReturnType<typeof getUnifiedMarketActivity>>>>();

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const requested = Number(request.nextUrl.searchParams.get("limit") || 30);
  const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.floor(requested))) : 30;
  try {
    const cached = feedCache.get(limit);
    if (cached && cached.expiresAt > Date.now()) return NextResponse.json({ activity: cached.activity }, { headers: { "cache-control": "private, no-store", "x-mxm-cache": "hit" } });
    let pending = feedInFlight.get(limit);
    if (!pending) {
      pending = getUnifiedMarketActivity(getSupabaseAdmin(), limit);
      feedInFlight.set(limit, pending);
    }
    let activity: Awaited<ReturnType<typeof getUnifiedMarketActivity>>;
    try { activity = await pending; }
    finally { if (feedInFlight.get(limit) === pending) feedInFlight.delete(limit); }
    feedCache.set(limit, { expiresAt: Date.now() + 2_500, activity });
    if (feedCache.size > 12) for (const [key, value] of feedCache) if (value.expiresAt <= Date.now()) feedCache.delete(key);
    return NextResponse.json({ activity }, { headers: { "cache-control": "private, no-store", "x-mxm-cache": "miss" } });
  } catch (error) {
    console.error("feed", error);
    return apiFailure(error, "Не удалось загрузить ленту рынка");
  }
}
export const GET = withApiErrors("app/api/feed/route.ts:GET", GETHandler);
