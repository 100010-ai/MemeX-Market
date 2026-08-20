import { NextResponse } from "next/server";
import { requireProfile, getProfileSnapshot } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";

type DbRow = Record<string, unknown>;

function relationOne(value: unknown, label: string): DbRow {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") throw new Error(`${label} relation is missing`);
  return row as DbRow;
}

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  try {
    const [coinsResult, giftsResult, coinHistoryResult, giftHistoryResult, snapshot] = await Promise.all([
      supabase.from("holdings").select("coin_id,quantity,cost_basis,coins(name,symbol,current_price,image_url)").eq("profile_id", profile.id).gt("quantity", 0),
      supabase.from("gift_market_overview").select(giftMarketSelect).eq("owner_profile_id", profile.id).not("telegram_name", "is", null).order("created_at", { ascending: false }),
      supabase.from("trades").select("id,coin_id,side,quote_amount,realized_pnl,created_at,coins(symbol)").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(40),
      supabase.from("gift_trades").select("id,virtual_gift_id,buyer_profile_id,seller_profile_id,price,realized_pnl,created_at,gift_assets(base_name,gift_number)").or(`buyer_profile_id.eq.${profile.id},seller_profile_id.eq.${profile.id}`).order("created_at", { ascending: false }).limit(40),
      getProfileSnapshot(profile as Record<string, unknown>),
    ]);
    const firstError = coinsResult.error || giftsResult.error || coinHistoryResult.error || giftHistoryResult.error;
    if (firstError) throw firstError;
    const holdings = ((coinsResult.data || []) as DbRow[]).map((row) => {
      const coin = relationOne(row.coins, "Portfolio coin");
      const quantity = Number(row.quantity);
      const currentPrice = Number(coin.current_price);
      const marketValue = quantity * currentPrice;
      const costBasis = Number(row.cost_basis);
      return { coinId: String(row.coin_id), name: coin.name, symbol: coin.symbol, imageUrl: typeof coin.image_url === "string" ? coin.image_url : null, quantity, currentPrice, marketValue, costBasis, pnl: marketValue - costBasis };
    });
    const mappedGifts = (giftsResult.data || []).map(mapGift);
    const unrealizedCoinPnl = holdings.reduce((sum, holding) => sum + holding.pnl, 0);
    const unrealizedGiftPnl = mappedGifts.reduce((sum, gift) => {
      const current = gift.estimatedValue ?? gift.listingPrice ?? gift.referencePrice ?? gift.lastSalePrice ?? gift.acquiredPrice;
      return sum + (Number(current) - Number(gift.acquiredPrice));
    }, 0);
    const history = [
      ...((coinHistoryResult.data || []) as DbRow[]).map((row) => {
        const coin = relationOne(row.coins, "Coin history");
        if (typeof coin.symbol !== "string" || !coin.symbol) throw new Error("Coin history symbol is missing");
        return { id: `coin-${String(row.id)}`, kind: "coin", label: `${row.side === "buy" ? "Куплено" : "Продано"} $${coin.symbol}`, amount: Number(row.quote_amount), pnl: Number(row.realized_pnl), createdAt: String(row.created_at), href: `/coin/${String(row.coin_id)}` };
      }),
      ...((giftHistoryResult.data || []) as DbRow[]).map((row) => {
        const gift = relationOne(row.gift_assets, "Gift history");
        if (typeof gift.base_name !== "string" || !gift.base_name || !Number.isFinite(Number(gift.gift_number))) throw new Error("Gift history metadata is missing");
        const sold = String(row.seller_profile_id) === String(profile.id);
        return { id: `gift-${String(row.id)}`, kind: "gift", label: `${sold ? "Продан" : "Куплен"} ${gift.base_name} #${Number(gift.gift_number)}`, amount: Number(row.price), pnl: sold ? Number(row.realized_pnl) : 0, createdAt: String(row.created_at), href: `/gifts/${String(row.virtual_gift_id)}` };
      }),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 50);
    const bucketStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    const snapshotWrite = await supabase.from("portfolio_snapshots").upsert({
      profile_id: profile.id,
      bucket_start: bucketStart,
      balance: snapshot.balance,
      coin_value: snapshot.coinValue,
      gift_value: snapshot.giftValue,
      net_worth: snapshot.netWorth,
      realized_pnl: snapshot.pnl,
    }, { onConflict: "profile_id,bucket_start" });
    if (snapshotWrite.error && !/portfolio_snapshots|schema cache|does not exist/i.test(snapshotWrite.error.message || "")) throw snapshotWrite.error;
    let portfolioSeries: Array<{ time: string; balance: number; coinValue: number; giftValue: number; netWorth: number; realizedPnl: number }> = [];
    const seriesResult = await supabase.from("portfolio_snapshots").select("bucket_start,balance,coin_value,gift_value,net_worth,realized_pnl").eq("profile_id", profile.id).order("bucket_start", { ascending: true }).limit(5000);
    if (!seriesResult.error) portfolioSeries = (seriesResult.data || []).map((row) => ({ time: String(row.bucket_start), balance: Number(row.balance), coinValue: Number(row.coin_value), giftValue: Number(row.gift_value), netWorth: Number(row.net_worth), realizedPnl: Number(row.realized_pnl) }));
    return NextResponse.json({
      holdings,
      gifts: mappedGifts,
      profile: snapshot,
      analytics: {
        realizedPnl: snapshot.pnl,
        unrealizedPnl: unrealizedCoinPnl + unrealizedGiftPnl,
        unrealizedCoinPnl,
        unrealizedGiftPnl,
      },
      history,
      portfolioSeries,
    });
  } catch (error) {
    console.error("portfolio", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить хранилище" }, { status: 500 });
  }
}
