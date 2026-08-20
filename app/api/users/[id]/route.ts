import { NextResponse } from "next/server";
import { progressionForXp, requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapCoin, mapGift } from "@/lib/mappers";
import { validUuidLike } from "@/lib/security";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireProfile();
  if (!viewer) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID игрока" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  try {
    await supabase.rpc("refresh_profile_meta_v048", { p_profile_id: id });
    const [profileResult, coinsResult, giftsResult, reputationResult, achievementsResult, statsResult] = await Promise.all([
      supabase.from("profiles").select("id,username,first_name,photo_url,created_at,xp").eq("id", id).maybeSingle(),
      supabase.from("market_overview").select("id,creator_profile_id,name,symbol,image_url,description,current_price,market_cap,volume_24h,change_24h,holder_count,trade_count_24h,created_at,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,total_supply,token_reserve,quote_reserve").eq("creator_profile_id", id).order("market_cap", { ascending: false }).limit(12),
      supabase.from("gift_market_overview").select(giftMarketSelect).eq("owner_profile_id", id).not("telegram_name", "is", null).order("estimated_value", { ascending: false, nullsFirst: false }).limit(8),
      supabase.from("profile_reputation").select("score,trade_score,age_score,activity_score,trust_score,updated_at").eq("profile_id", id).maybeSingle(),
      supabase.from("user_achievements").select("achievement_key,unlocked_at,achievements(title,description,icon,xp_reward,sort_order)").eq("profile_id", id).order("unlocked_at", { ascending: false }).limit(12),
      supabase.rpc("public_profile_stats_v056", { p_profile_id: id }),
    ]);
    const error = profileResult.error || coinsResult.error || giftsResult.error || statsResult.error;
    if (error) throw error;
    if (!profileResult.data) return NextResponse.json({ error: "Игрок не найден" }, { status: 404 });
    const person: any = profileResult.data;
    const stats: any = statsResult.data || {};
    const progression = progressionForXp(Number(person.xp || 0));
    const giftSales = Number(stats.giftSales || 0);
    const coinTradeCount = Number(stats.coinTradeCount || 0);
    return NextResponse.json({
      profile: {
        id: String(person.id),
        name: person.username ? `@${person.username}` : person.first_name,
        username: person.username || null,
        firstName: person.first_name,
        photoUrl: person.photo_url || null,
        joinedAt: person.created_at,
        xp: progression.xp,
        level: progression.level,
        tradeCount: coinTradeCount + giftSales,
        giftCount: Number(stats.giftCount || 0),
        giftSales,
        giftTradeVolume: Number(stats.giftTradeVolume || 0),
        coinTradeCount,
        coinTradeVolume: Number(stats.coinTradeVolume || 0),
        createdCoinCount: Number(stats.createdCoinCount || 0),
        createdCoins: (coinsResult.data || []).map(mapCoin),
        showcase: (giftsResult.data || []).map(mapGift),
        reputation: reputationResult.data ? { score: Number(reputationResult.data.score), tradeScore: Number(reputationResult.data.trade_score), ageScore: Number(reputationResult.data.age_score), activityScore: Number(reputationResult.data.activity_score), trustScore: Number(reputationResult.data.trust_score), updatedAt: String(reputationResult.data.updated_at) } : null,
        achievements: (achievementsResult.data || []).map((item: any) => ({ key: item.achievement_key, unlockedAt: item.unlocked_at, title: item.achievements?.title || item.achievement_key, description: item.achievements?.description || "", icon: item.achievements?.icon || "award", xpReward: Number(item.achievements?.xp_reward || 0) })),
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("public profile", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить игрока" }, { status: 500 });
  }
}
