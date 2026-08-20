import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapProfileBadges, missingProfilePresentationSchema } from "@/lib/profile-presentation";

type AchievementRow = {
  achievement_key: string;
  unlocked_at: string;
  achievements: { title?: string; description?: string; icon?: string; xp_reward?: number } | Array<{ title?: string; description?: string; icon?: string; xp_reward?: number }> | null;
};

function mapAchievement(raw: unknown) {
  const row = raw as AchievementRow;
  const joined = Array.isArray(row.achievements) ? row.achievements[0] : row.achievements;
  return { key: row.achievement_key, unlockedAt: row.unlocked_at, title: joined?.title || row.achievement_key, description: joined?.description || "", icon: joined?.icon || "award", xpReward: Number(joined?.xp_reward || 0) };
}

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const refreshed = await supabase.rpc("refresh_profile_meta_v048", { p_profile_id: profile.id });
  if (refreshed.error) return NextResponse.json({ error: refreshed.error.message }, { status: 500 });
  const [reputation, achievements, presentation, verifiedEntitlement, badgeInventory] = await Promise.all([
    supabase.from("profile_reputation").select("score,trade_score,age_score,activity_score,trust_score,updated_at").eq("profile_id", profile.id).single(),
    supabase.from("user_achievements").select("achievement_key,unlocked_at,achievements(title,description,icon,xp_reward,sort_order)").eq("profile_id", profile.id).order("unlocked_at", { ascending: false }),
    supabase.from("profiles").select("equipped_profile_frame").eq("id", profile.id).single(),
    supabase.from("profile_entitlements").select("expires_at").eq("profile_id", profile.id).eq("entitlement_key", "creator_verified").maybeSingle(),
    supabase.from("profile_item_inventory").select("item_key,acquired_at,profile_items!inner(title,rarity,item_type,active)").eq("profile_id", profile.id).eq("profile_items.item_type", "badge").eq("profile_items.active", true).order("acquired_at", { ascending: false }).limit(12),
  ]);
  const optionalError = [presentation.error, verifiedEntitlement.error, badgeInventory.error]
    .find((error) => error && !missingProfilePresentationSchema(error));
  const error = reputation.error || achievements.error || optionalError;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const verifiedExpiresAt = verifiedEntitlement.data?.expires_at;
  const creatorVerified = Boolean(verifiedEntitlement.data)
    && (!verifiedExpiresAt || new Date(verifiedExpiresAt).getTime() > Date.now());
  return NextResponse.json({
    reputation: { score: Number(reputation.data.score), tradeScore: Number(reputation.data.trade_score), ageScore: Number(reputation.data.age_score), activityScore: Number(reputation.data.activity_score), trustScore: Number(reputation.data.trust_score), updatedAt: reputation.data.updated_at },
    achievements: (achievements.data || []).map(mapAchievement),
    appearance: {
      equippedProfileFrame: presentation.error ? null : presentation.data?.equipped_profile_frame || null,
      creatorVerified: verifiedEntitlement.error ? false : creatorVerified,
      badges: badgeInventory.error ? [] : mapProfileBadges(badgeInventory.data),
    },
  }, { headers: { "cache-control": "private, no-store" } });
}
