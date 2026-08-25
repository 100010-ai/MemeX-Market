import { apiFailure, withApiErrors } from "@/lib/api-route";
import { after, NextRequest, NextResponse } from "next/server";
import { requireProfile, getProfileSnapshot } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import { isInspectionSession } from "@/lib/session";

type DbRow = Record<string, unknown>;

const DEFAULT_GIFT_PAGE_SIZE = 96;
const MAX_GIFT_PAGE_SIZE = 192;
const COST_BASIS_PAGE_SIZE = 1000;
const MAX_COST_BASIS_PAGES = 100;

function boundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

async function fetchOwnedGifts(profileId: string, offset: number, limit: number) {
  const supabase = getSupabaseAdmin();
  const result = await supabase.from("gift_market_overview")
    .select(giftMarketSelect, { count: "exact" })
    .eq("owner_profile_id", profileId)
    .not("telegram_name", "is", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (result.error) throw result.error;
  const total = Math.max(0, Number(result.count || 0));
  const rows = (result.data || []) as DbRow[];
  const nextOffset = offset + rows.length < total ? offset + rows.length : null;
  return { rows, total, nextOffset };
}

async function fetchGiftCostBasis(profileId: string) {
  const supabase = getSupabaseAdmin();
  let offset = 0;
  let total = 0;
  for (let page = 0; page < MAX_COST_BASIS_PAGES; page += 1) {
    const result = await supabase.from("gift_market_overview")
      .select("virtual_gift_id,acquired_price")
      .eq("owner_profile_id", profileId)
      .eq("is_burned", false)
      .order("virtual_gift_id", { ascending: true })
      .range(offset, offset + COST_BASIS_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const rows = result.data || [];
    total += rows.reduce((sum, row) => sum + Math.max(0, finiteNumber(row.acquired_price)), 0);
    if (rows.length < COST_BASIS_PAGE_SIZE) return total;
    offset += rows.length;
  }
  throw new Error("Gift inventory exceeds supported analytics window");
}

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

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const inspection = await isInspectionSession();
  const supabase = getSupabaseAdmin();
  const giftOffset = boundedInt(request.nextUrl.searchParams.get("giftOffset"), 0, 0, 100_000);
  const giftLimit = boundedInt(request.nextUrl.searchParams.get("giftLimit"), DEFAULT_GIFT_PAGE_SIZE, 30, MAX_GIFT_PAGE_SIZE);
  const giftsOnly = request.nextUrl.searchParams.get("giftsOnly") === "1";
  try {
    if (giftsOnly) {
      const giftsInventory = await fetchOwnedGifts(String(profile.id), giftOffset, giftLimit);
      const mappedGifts = giftsInventory.rows.map(mapGift).filter((gift) => Boolean(gift.virtualGiftId));
      return NextResponse.json({ gifts: mappedGifts, inventory: { giftCount: giftsInventory.total, giftsLoaded: mappedGifts.length, nextGiftOffset: giftsInventory.nextOffset } }, { headers: { "cache-control": "private, no-store" } });
    }

    const [coinsResult, giftsInventory, giftCostBasis, listedGiftsResult, coinHistoryResult, giftHistoryResult, snapshot, seriesResult] = await Promise.all([
      supabase.from("holdings").select("coin_id,quantity,cost_basis,coins(name,symbol,current_price,image_url)").eq("profile_id", profile.id).gt("quantity", 0),
      fetchOwnedGifts(String(profile.id), giftOffset, giftLimit),
      fetchGiftCostBasis(String(profile.id)),
      supabase.from("gift_market_overview").select(giftMarketSelect).eq("owner_profile_id", profile.id).eq("status", "listed").not("telegram_name", "is", null).order("listing_price", { ascending: true }).limit(500),
      supabase.from("trades").select("id,coin_id,side,quote_amount,realized_pnl,created_at,coins(symbol)").eq("profile_id", profile.id).eq("is_launch_seed", false).order("created_at", { ascending: false }).limit(40),
      supabase.from("gift_trades").select("id,virtual_gift_id,buyer_profile_id,seller_profile_id,price,realized_pnl,created_at,gift_assets(base_name,gift_number)").or(`buyer_profile_id.eq.${profile.id},seller_profile_id.eq.${profile.id}`).order("created_at", { ascending: false }).limit(40),
      getProfileSnapshot(profile as Record<string, unknown>),
      supabase.from("portfolio_snapshots").select("bucket_start,balance,coin_value,gift_value,net_worth,realized_pnl").eq("profile_id", profile.id).order("bucket_start", { ascending: false }).limit(720),
    ]);
    const firstError = coinsResult.error || listedGiftsResult.error || coinHistoryResult.error || giftHistoryResult.error || seriesResult.error;
    if (firstError) throw firstError;
    const listedGifts = ((listedGiftsResult.data || []) as DbRow[]).map(mapGift).filter((gift) => Boolean(gift.virtualGiftId));
    const holdings = ((coinsResult.data || []) as DbRow[]).flatMap((row) => {
      const coinId = text(row.coin_id);
      if (!coinId) return [];
      const coin = relationOne(row.coins);
      const quantity = finiteNumber(row.quantity);
      const currentPrice = finiteNumber(coin.current_price);
      const marketValue = quantity * currentPrice;
      const costBasis = finiteNumber(row.cost_basis);
      return [{ coinId, name: text(coin.name, "Мемкоин"), symbol: text(coin.symbol, "—"), imageUrl: typeof coin.image_url === "string" && coin.image_url.trim() ? coin.image_url.trim() : null, quantity, currentPrice, marketValue, costBasis, pnl: marketValue - costBasis }];
    });
    const mappedGifts = giftsInventory.rows.map(mapGift).filter((gift) => Boolean(gift.virtualGiftId));
    const unrealizedCoinPnl = holdings.reduce((sum, holding) => sum + holding.pnl, 0);
    const unrealizedGiftPnl = finiteNumber(snapshot.giftValue) - giftCostBasis;
    const history = [
      ...((coinHistoryResult.data || []) as DbRow[]).flatMap((row) => {
        const id = text(row.id); const coinId = text(row.coin_id); if (!id || !coinId) return [];
        const coin = relationOne(row.coins);
        return [{ id: `coin-${id}`, kind: "coin", label: `${row.side === "buy" ? "Куплено" : "Продано"} $${text(coin.symbol, "—")}`, amount: finiteNumber(row.quote_amount), pnl: finiteNumber(row.realized_pnl), createdAt: isoDate(row.created_at), href: `/coin/${coinId}` }];
      }),
      ...((giftHistoryResult.data || []) as DbRow[]).flatMap((row) => {
        const id = text(row.id); const virtualGiftId = text(row.virtual_gift_id); if (!id || !virtualGiftId) return [];
        const gift = relationOne(row.gift_assets); const sold = text(row.seller_profile_id) === String(profile.id);
        return [{ id: `gift-${id}`, kind: "gift", label: `${sold ? "Продан" : "Куплен"} ${text(gift.base_name, "Подарок")} #${finiteNumber(gift.gift_number)}`, amount: finiteNumber(row.price), pnl: sold ? finiteNumber(row.realized_pnl) : 0, createdAt: isoDate(row.created_at), href: `/gifts/${virtualGiftId}` }];
      }),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 50);
    const bucketStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    const currentPoint = { time: bucketStart, balance: finiteNumber(snapshot.balance), coinValue: finiteNumber(snapshot.coinValue), giftValue: finiteNumber(snapshot.giftValue), netWorth: finiteNumber(snapshot.netWorth), realizedPnl: finiteNumber(snapshot.pnl) };
    const portfolioSeries = (seriesResult.data || []).map((row) => ({ time: isoDate(row.bucket_start), balance: finiteNumber(row.balance), coinValue: finiteNumber(row.coin_value), giftValue: finiteNumber(row.gift_value), netWorth: finiteNumber(row.net_worth), realizedPnl: finiteNumber(row.realized_pnl) })).reverse();
    const last = portfolioSeries[portfolioSeries.length - 1];
    if (last?.time === bucketStart) portfolioSeries[portfolioSeries.length - 1] = currentPoint; else portfolioSeries.push(currentPoint);

    if (!inspection) after(async () => {
      try {
        const write = await getSupabaseAdmin().from("portfolio_snapshots").upsert({ profile_id: profile.id, bucket_start: bucketStart, balance: currentPoint.balance, coin_value: currentPoint.coinValue, gift_value: currentPoint.giftValue, net_worth: currentPoint.netWorth, realized_pnl: currentPoint.realizedPnl }, { onConflict: "profile_id,bucket_start" });
        if (write.error) console.error("portfolio snapshot write", write.error);
      } catch (writeError) { console.error("portfolio snapshot write", writeError); }
    });
    return NextResponse.json({ holdings, gifts: mappedGifts, listedGifts, profile: snapshot, analytics: { realizedPnl: snapshot.pnl, unrealizedPnl: unrealizedCoinPnl + unrealizedGiftPnl, unrealizedCoinPnl, unrealizedGiftPnl }, history, portfolioSeries, inventory: { giftCount: giftsInventory.total, giftsLoaded: mappedGifts.length, nextGiftOffset: giftsInventory.nextOffset } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("portfolio", error);
    return apiFailure(error, "Не удалось загрузить хранилище");
  }
}
export const GET = withApiErrors("app/api/portfolio/route.ts:GET", GETHandler);
