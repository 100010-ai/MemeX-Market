import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile, getProfileSnapshot } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";

type DbRow = Record<string, unknown>;

function relationOne(value: unknown): DbRow {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as DbRow : {};
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isoDate(value: unknown) {
  const candidate = typeof value === "string" || value instanceof Date ? new Date(value) : null;
  return candidate && Number.isFinite(candidate.getTime()) ? candidate.toISOString() : new Date(0).toISOString();
}

async function GETHandler() {
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
    const holdings = ((coinsResult.data || []) as DbRow[]).flatMap((row) => {
      const coinId = text(row.coin_id);
      if (!coinId) return [];
      const coin = relationOne(row.coins);
      const quantity = finiteNumber(row.quantity);
      const currentPrice = finiteNumber(coin.current_price);
      const marketValue = quantity * currentPrice;
      const costBasis = finiteNumber(row.cost_basis);
      return [{
        coinId,
        name: text(coin.name, "Мемкоин"),
        symbol: text(coin.symbol, "—"),
        imageUrl: typeof coin.image_url === "string" && coin.image_url.trim() ? coin.image_url.trim() : null,
        quantity,
        currentPrice,
        marketValue,
        costBasis,
        pnl: marketValue - costBasis,
      }];
    });
    const mappedGifts = (giftsResult.data || []).map(mapGift);
    const unrealizedCoinPnl = holdings.reduce((sum, holding) => sum + holding.pnl, 0);
    const unrealizedGiftPnl = mappedGifts.reduce((sum, gift) => {
      const current = gift.estimatedValue ?? gift.listingPrice ?? gift.referencePrice ?? gift.lastSalePrice ?? gift.acquiredPrice;
      return sum + (Number(current) - Number(gift.acquiredPrice));
    }, 0);
    const history = [
      ...((coinHistoryResult.data || []) as DbRow[]).flatMap((row) => {
        const id = text(row.id);
        const coinId = text(row.coin_id);
        if (!id || !coinId) return [];
        const coin = relationOne(row.coins);
        return [{ id: `coin-${id}`, kind: "coin", label: `${row.side === "buy" ? "Куплено" : "Продано"} $${text(coin.symbol, "—")}`, amount: finiteNumber(row.quote_amount), pnl: finiteNumber(row.realized_pnl), createdAt: isoDate(row.created_at), href: `/coin/${coinId}` }];
      }),
      ...((giftHistoryResult.data || []) as DbRow[]).flatMap((row) => {
        const id = text(row.id);
        const virtualGiftId = text(row.virtual_gift_id);
        if (!id || !virtualGiftId) return [];
        const gift = relationOne(row.gift_assets);
        const sold = text(row.seller_profile_id) === String(profile.id);
        return [{ id: `gift-${id}`, kind: "gift", label: `${sold ? "Продан" : "Куплен"} ${text(gift.base_name, "Подарок")} #${finiteNumber(gift.gift_number)}`, amount: finiteNumber(row.price), pnl: sold ? finiteNumber(row.realized_pnl) : 0, createdAt: isoDate(row.created_at), href: `/gifts/${virtualGiftId}` }];
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
    if (snapshotWrite.error) throw snapshotWrite.error;
    let portfolioSeries: Array<{ time: string; balance: number; coinValue: number; giftValue: number; netWorth: number; realizedPnl: number }> = [];
    const seriesResult = await supabase.from("portfolio_snapshots").select("bucket_start,balance,coin_value,gift_value,net_worth,realized_pnl").eq("profile_id", profile.id).order("bucket_start", { ascending: true }).limit(5000);
    if (seriesResult.error) throw seriesResult.error;
    portfolioSeries = (seriesResult.data || []).map((row) => ({ time: isoDate(row.bucket_start), balance: finiteNumber(row.balance), coinValue: finiteNumber(row.coin_value), giftValue: finiteNumber(row.gift_value), netWorth: finiteNumber(row.net_worth), realizedPnl: finiteNumber(row.realized_pnl) }));
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
    return apiFailure(error, "Не удалось загрузить хранилище");
  }
}
export const GET = withApiErrors("app/api/portfolio/route.ts:GET", GETHandler);
