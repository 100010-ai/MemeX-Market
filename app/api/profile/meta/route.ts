import { apiFailure, withApiErrors } from "@/lib/api-route";
import { after, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapProfileBadges } from "@/lib/profile-presentation";
import { finiteNumber, safeIsoDate, text } from "@/lib/safe-data";

type AchievementRow = { achievement_key: string; unlocked_at: string; achievements: { title?: string; description?: string; icon?: string; xp_reward?: number } | Array<{ title?: string; description?: string; icon?: string; xp_reward?: number }> | null };
function mapAchievement(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<AchievementRow>;
  const key = text(row.achievement_key, "", 100); if (!key) return null;
  const joined = Array.isArray(row.achievements) ? row.achievements[0] : row.achievements;
  return { key, unlockedAt: safeIsoDate(row.unlocked_at), title: text(joined?.title, key, 160), description: text(joined?.description, "", 500), icon: text(joined?.icon, "award", 64), xpReward: finiteNumber(joined?.xp_reward) };
}
function traderSnapshot(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawRank = Number(row.collectorRank);
  return {
    tradeCount: Math.max(0, Math.floor(finiteNumber(row.tradeCount))), tradeVolume: Math.max(0, finiteNumber(row.tradeVolume)),
    giftTradeVolume: Math.max(0, finiteNumber(row.giftTradeVolume)), coinTradeVolume: Math.max(0, finiteNumber(row.coinTradeVolume)),
    closedTrades: Math.max(0, Math.floor(finiteNumber(row.closedTrades))), winningTrades: Math.max(0, Math.floor(finiteNumber(row.winningTrades))),
    winRate: Math.max(0, Math.min(100, finiteNumber(row.winRate))), activeDays: Math.max(0, Math.floor(finiteNumber(row.activeDays))),
    lastActivityAt: row.lastActivityAt ? safeIsoDate(row.lastActivityAt) : null,
    collectorScore: Math.max(0, Math.min(100, finiteNumber(row.collectorScore))), collectorRank: Number.isFinite(rawRank) && rawRank > 0 ? Math.floor(rawRank) : null,
    giftCount: Math.max(0, Math.floor(finiteNumber(row.giftCount))), uniqueCollections: Math.max(0, Math.floor(finiteNumber(row.uniqueCollections))),
    rareGiftCount: Math.max(0, Math.floor(finiteNumber(row.rareGiftCount))), avgRarityScore: Math.max(0, Math.min(100, finiteNumber(row.avgRarityScore))),
    collectionValue: Math.max(0, finiteNumber(row.collectionValue)),
  };
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const [reputation, achievements, presentation, verifiedEntitlement, badgeInventory, trader] = await Promise.all([
    supabase.from("profile_reputation").select("score,trade_score,age_score,activity_score,trust_score,updated_at").eq("profile_id", profile.id).maybeSingle(),
    supabase.from("user_achievements").select("achievement_key,unlocked_at,achievements(title,description,icon,xp_reward,sort_order)").eq("profile_id", profile.id).order("unlocked_at", { ascending: false }).limit(100),
    supabase.from("profiles").select("equipped_profile_frame").eq("id", profile.id).maybeSingle(),
    supabase.from("profile_entitlements").select("expires_at").eq("profile_id", profile.id).eq("entitlement_key", "creator_verified").maybeSingle(),
    supabase.from("profile_item_inventory").select("item_key,acquired_at,profile_items!inner(title,rarity,item_type,active)").eq("profile_id", profile.id).eq("profile_items.item_type", "badge").eq("profile_items.active", true).order("acquired_at", { ascending: false }).limit(12),
    supabase.rpc("trader_profile_stats_v200", { p_profile_id: profile.id }),
  ]);
  const error = reputation.error || achievements.error || presentation.error || verifiedEntitlement.error || badgeInventory.error || trader.error;
  if (error) return apiFailure(error, "Не удалось выполнить запрос");
  const reputationUpdatedAt = reputation.data?.updated_at ? Date.parse(String(reputation.data.updated_at)) : 0;
  if (!Number.isFinite(reputationUpdatedAt) || Date.now() - reputationUpdatedAt > 5 * 60_000) after(async () => { try { const refreshed = await getSupabaseAdmin().rpc("refresh_profile_meta_v048", { p_profile_id: profile.id }); if (refreshed.error) console.error("profile meta refresh", refreshed.error); } catch (error) { console.error("profile meta refresh", error); } });
  const verifiedExpiresAt = verifiedEntitlement.data?.expires_at; const verifiedExpiry = verifiedExpiresAt ? new Date(verifiedExpiresAt).getTime() : null;
  const creatorVerified = Boolean(verifiedEntitlement.data) && (verifiedExpiry == null || (Number.isFinite(verifiedExpiry) && verifiedExpiry > Date.now()));
  const rep = reputation.data ?? { score: 50, trade_score: 0, age_score: 0, activity_score: 0, trust_score: 50, updated_at: new Date(0).toISOString() };
  return NextResponse.json({
    reputation: { score: finiteNumber(rep.score, 50), tradeScore: finiteNumber(rep.trade_score), ageScore: finiteNumber(rep.age_score), activityScore: finiteNumber(rep.activity_score), trustScore: finiteNumber(rep.trust_score, 50), updatedAt: safeIsoDate(rep.updated_at) },
    trader: traderSnapshot(trader.data),
    achievements: (achievements.data || []).flatMap((raw) => { const value = mapAchievement(raw); return value ? [value] : []; }),
    appearance: { equippedProfileFrame: text(presentation.data?.equipped_profile_frame, "", 120) || null, creatorVerified, badges: mapProfileBadges(badgeInventory.data) },
  }, { headers: { "cache-control": "private, no-store" } });
}
export const GET = withApiErrors("app/api/profile/meta/route.ts:GET", GETHandler);
