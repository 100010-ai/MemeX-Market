import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapProfileBadges } from "@/lib/profile-presentation";
import { finiteNumber, safeIsoDate, text } from "@/lib/safe-data";

type AchievementRow = {
  achievement_key: string;
  unlocked_at: string;
  achievements: { title?: string; description?: string; icon?: string; xp_reward?: number } | Array<{ title?: string; description?: string; icon?: string; xp_reward?: number }> | null;
};

function mapAchievement(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<AchievementRow>;
  const key = text(row.achievement_key, "", 100);
  if (!key) return null;
  const joined = Array.isArray(row.achievements) ? row.achievements[0] : row.achievements;
  return {
    key,
    unlockedAt: safeIsoDate(row.unlocked_at),
    title: text(joined?.title, key, 160),
    description: text(joined?.description, "", 500),
    icon: text(joined?.icon, "award", 64),
    xpReward: finiteNumber(joined?.xp_reward),
  };
}


async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const refreshed = await supabase.rpc("refresh_profile_meta_v048", { p_profile_id: profile.id });
  if (refreshed.error) return NextResponse.json({ error: refreshed.error.message }, { status: 500 });
  const [reputation, achievements, presentation, verifiedEntitlement, badgeInventory] = await Promise.all([
    supabase.from("profile_reputation").select("score,trade_score,age_score,activity_score,trust_score,updated_at").eq("profile_id", profile.id).maybeSingle(),
    supabase.from("user_achievements").select("achievement_key,unlocked_at,achievements(title,description,icon,xp_reward,sort_order)").eq("profile_id", profile.id).order("unlocked_at", { ascending: false }),
    supabase.from("profiles").select("equipped_profile_frame").eq("id", profile.id).maybeSingle(),
    supabase.from("profile_entitlements").select("expires_at").eq("profile_id", profile.id).eq("entitlement_key", "creator_verified").maybeSingle(),
    supabase.from("profile_item_inventory").select("item_key,acquired_at,profile_items!inner(title,rarity,item_type,active)").eq("profile_id", profile.id).eq("profile_items.item_type", "badge").eq("profile_items.active", true).order("acquired_at", { ascending: false }).limit(12),
  ]);
  const error = reputation.error || achievements.error || presentation.error || verifiedEntitlement.error || badgeInventory.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const verifiedExpiresAt = verifiedEntitlement.data?.expires_at;
  const verifiedExpiry = verifiedExpiresAt ? new Date(verifiedExpiresAt).getTime() : null;
  const creatorVerified = Boolean(verifiedEntitlement.data)
    && (verifiedExpiry == null || (Number.isFinite(verifiedExpiry) && verifiedExpiry > Date.now()));
  const rep = reputation.data ?? { score: 50, trade_score: 0, age_score: 0, activity_score: 0, trust_score: 50, updated_at: new Date(0).toISOString() };
  return NextResponse.json({
    reputation: { score: finiteNumber(rep.score, 50), tradeScore: finiteNumber(rep.trade_score), ageScore: finiteNumber(rep.age_score), activityScore: finiteNumber(rep.activity_score), trustScore: finiteNumber(rep.trust_score, 50), updatedAt: safeIsoDate(rep.updated_at) },
    achievements: (achievements.data || []).flatMap((raw) => { const value = mapAchievement(raw); return value ? [value] : []; }),
    appearance: {
      equippedProfileFrame: text(presentation.data?.equipped_profile_frame, "", 120) || null,
      creatorVerified,
      badges: mapProfileBadges(badgeInventory.data),
    },
  }, { headers: { "cache-control": "private, no-store" } });
}
export const GET = withApiErrors("app/api/profile/meta/route.ts:GET", GETHandler);
