import { apiFailure, withApiErrors } from "@/lib/api-route";
import { after, NextResponse } from "next/server";
import { progressionForXp, requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapCoin, mapGift } from "@/lib/mappers";
import { validUuidLike } from "@/lib/security";
import { mapProfileBadges } from "@/lib/profile-presentation";
import { finiteNumber, nonEmptyId, nullableText, safeIsoDate, text } from "@/lib/safe-data";

type AchievementRow = { achievement_key: string; unlocked_at: string; achievements: { title?: string; description?: string; icon?: string; xp_reward?: number } | Array<{ title?: string; description?: string; icon?: string; xp_reward?: number }> | null };
function mapAchievement(raw: unknown) { const row = raw as AchievementRow; const joined = Array.isArray(row.achievements) ? row.achievements[0] : row.achievements; return { key: row.achievement_key, unlockedAt: row.unlocked_at, title: joined?.title || row.achievement_key, description: joined?.description || "", icon: joined?.icon || "award", xpReward: Number(joined?.xp_reward || 0) }; }
function traderSnapshot(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rank = Number(row.collectorRank);
  return {
    tradeCount: Math.max(0, Math.floor(finiteNumber(row.tradeCount))), tradeVolume: Math.max(0, finiteNumber(row.tradeVolume)),
    giftTradeVolume: Math.max(0, finiteNumber(row.giftTradeVolume)), coinTradeVolume: Math.max(0, finiteNumber(row.coinTradeVolume)),
    closedTrades: Math.max(0, Math.floor(finiteNumber(row.closedTrades))), winningTrades: Math.max(0, Math.floor(finiteNumber(row.winningTrades))), winRate: Math.max(0, Math.min(100, finiteNumber(row.winRate))),
    activeDays: Math.max(0, Math.floor(finiteNumber(row.activeDays))), collectorScore: Math.max(0, Math.min(100, finiteNumber(row.collectorScore))), collectorRank: Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : null,
    giftCount: Math.max(0, Math.floor(finiteNumber(row.giftCount))), uniqueCollections: Math.max(0, Math.floor(finiteNumber(row.uniqueCollections))), rareGiftCount: Math.max(0, Math.floor(finiteNumber(row.rareGiftCount))),
    avgRarityScore: Math.max(0, Math.min(100, finiteNumber(row.avgRarityScore))), collectionValue: Math.max(0, finiteNumber(row.collectionValue)),
  };
}

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireProfile();
  if (!viewer) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID игрока" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  try {
    const [profileResult, coinsResult, giftsResult, reputationResult, achievementsResult, statsResult, verifiedEntitlementResult, badgeInventoryResult, traderResult] = await Promise.all([
      supabase.from("profiles").select("id,username,first_name,photo_url,created_at,xp,equipped_profile_frame").eq("id", id).maybeSingle(),
      supabase.from("market_overview").select("id,creator_profile_id,name,symbol,image_url,description,current_price,market_cap,volume_24h,change_24h,holder_count,trade_count_24h,created_at,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,total_supply,token_reserve,quote_reserve").eq("creator_profile_id", id).order("market_cap", { ascending: false }).limit(12),
      supabase.from("gift_market_overview").select(giftMarketSelect).eq("owner_profile_id", id).not("telegram_name", "is", null).order("estimated_value", { ascending: false, nullsFirst: false }).limit(8),
      supabase.from("profile_reputation").select("score,trade_score,age_score,activity_score,trust_score,updated_at").eq("profile_id", id).maybeSingle(),
      supabase.from("user_achievements").select("achievement_key,unlocked_at,achievements(title,description,icon,xp_reward,sort_order)").eq("profile_id", id).order("unlocked_at", { ascending: false }).limit(12),
      supabase.rpc("public_profile_stats_v056", { p_profile_id: id }),
      supabase.from("profile_entitlements").select("expires_at").eq("profile_id", id).eq("entitlement_key", "creator_verified").maybeSingle(),
      supabase.from("profile_item_inventory").select("item_key,acquired_at,profile_items!inner(title,rarity,item_type,active)").eq("profile_id", id).eq("profile_items.item_type", "badge").eq("profile_items.active", true).order("acquired_at", { ascending: false }).limit(12),
      supabase.rpc("trader_profile_stats_v200", { p_profile_id: id }),
    ]);
    const error = profileResult.error || coinsResult.error || giftsResult.error || reputationResult.error || achievementsResult.error || statsResult.error || verifiedEntitlementResult.error || badgeInventoryResult.error || traderResult.error;
    if (error) throw error;
    if (!profileResult.data) return NextResponse.json({ error: "Игрок не найден" }, { status: 404 });
    const reputationUpdatedAt = reputationResult.data?.updated_at ? Date.parse(String(reputationResult.data.updated_at)) : 0;
    const reputationStale = !Number.isFinite(reputationUpdatedAt) || Date.now() - reputationUpdatedAt > 5 * 60_000;
    if (reputationStale) after(async () => { try { const refresh = await getSupabaseAdmin().rpc("refresh_profile_meta_v048", { p_profile_id: id }); if (refresh.error) console.error("public profile meta refresh", refresh.error); } catch (error) { console.error("public profile meta refresh", error); } });

    const person = profileResult.data;
    const stats = statsResult.data && typeof statsResult.data === "object" && !Array.isArray(statsResult.data) ? statsResult.data as Record<string, unknown> : {};
    const progression = progressionForXp(finiteNumber(person.xp));
    const giftSales = finiteNumber(stats.giftSales); const coinTradeCount = finiteNumber(stats.coinTradeCount);
    const verifiedExpiresAt = verifiedEntitlementResult.data?.expires_at;
    const creatorVerified = Boolean(verifiedEntitlementResult.data) && (!verifiedExpiresAt || new Date(verifiedExpiresAt).getTime() > Date.now());
    return NextResponse.json({ profile: {
      id: nonEmptyId(person.id) || id,
      name: person.username ? `@${text(person.username, "Игрок", 64)}` : text(person.first_name, "Пользователь", 120), username: nullableText(person.username, 64), firstName: text(person.first_name, "Пользователь", 120), photoUrl: nullableText(person.photo_url, 2_000),
      equippedProfileFrame: text(person.equipped_profile_frame, "", 120) || null, creatorVerified, profileBadges: mapProfileBadges(badgeInventoryResult.data), joinedAt: safeIsoDate(person.created_at), xp: progression.xp, level: progression.level,
      tradeCount: coinTradeCount + giftSales, giftCount: finiteNumber(stats.giftCount), giftSales, giftTradeVolume: finiteNumber(stats.giftTradeVolume), coinTradeCount, coinTradeVolume: finiteNumber(stats.coinTradeVolume), createdCoinCount: finiteNumber(stats.createdCoinCount),
      trader: traderSnapshot(traderResult.data),
      createdCoins: (coinsResult.data || []).map(mapCoin).filter((coin) => Boolean(coin.id)), showcase: (giftsResult.data || []).map(mapGift).filter((gift) => Boolean(gift.virtualGiftId)),
      reputation: reputationResult.data ? { score: finiteNumber(reputationResult.data.score, 50), tradeScore: finiteNumber(reputationResult.data.trade_score), ageScore: finiteNumber(reputationResult.data.age_score), activityScore: finiteNumber(reputationResult.data.activity_score), trustScore: finiteNumber(reputationResult.data.trust_score, 50), updatedAt: safeIsoDate(reputationResult.data.updated_at) } : null,
      achievements: (achievementsResult.data || []).map(mapAchievement),
    } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error, "Не удалось загрузить игрока"); }
}
export const GET = withApiErrors("app/api/users/[id]/route.ts:GET", GETHandler);
