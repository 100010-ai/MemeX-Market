import crypto from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { readSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin, mapGift } from "@/lib/mappers";
import { maybeMaintainGiftMarket } from "@/lib/market/maintenance";
import type { GiftCollection } from "@/lib/types";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 60;
export const revalidate = 10;

const marketHeaders = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" };

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function mapCollection(row: Record<string, unknown>): GiftCollection {
  return {
    baseName: String(row.base_name),
    itemCount: Number(row.item_count),
    holderCount: Number(row.holder_count),
    listedCount: Number(row.listed_count),
    floorPrice: row.floor_price == null ? null : Number(row.floor_price),
    lastSalePrice: row.last_sale_price == null ? null : Number(row.last_sale_price),
    volume24h: Number(row.volume_24h),
    change24h: Number(row.change_24h),
    tradeCount24h: Number(row.trade_count_24h),
    volume7d: Number(row.volume_7d || 0),
    tradeCount7d: Number(row.trade_count_7d || 0),
    listedPct: Number(row.listed_pct || 0),
    allTimeVolume: Number(row.all_time_volume || 0),
    totalSales: Number(row.total_sales || 0),
    highSale: row.high_sale == null ? null : Number(row.high_sale),
    externalFloor: row.external_floor == null ? null : Number(row.external_floor),
  };
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const scope = request.nextUrl.searchParams.get("scope") === "coins" ? "coins" : "gifts";
  const runtimeConfig = await getRuntimeConfig().catch((error) => { console.error("market runtime config", error); return null; });
  if (!runtimeConfig) return NextResponse.json({ error: "Конфигурация рынка недоступна" }, { status: 503 });
  if (scope === "coins" && !runtimeConfig.featureFlags.memecoins) return NextResponse.json({ error: "Мемкоины временно отключены" }, { status: 503 });
  if (scope === "gifts" && !runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля Gifts временно отключена" }, { status: 503 });

  // Expiry is already enforced in every market view/RPC. Cleanup therefore
  // happens after the response and can never extend first paint latency.
  if (scope === "gifts") after(() => maybeMaintainGiftMarket());

  try {
    if (scope === "coins") {
      const profile = await requireProfile();
      if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const [coinsResult, watchlistResult, cartResult] = await Promise.all([
        supabase.from("market_overview").select("id,creator_profile_id,name,symbol,description,current_price,market_cap,status,created_at,total_supply,token_reserve,quote_reserve,volume_24h,change_24h,holder_count,trade_count_24h,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,image_url").eq("status", "active").order("volume_24h", { ascending: false }).order("created_at", { ascending: false }).limit(72),
        supabase.from("user_watchlist").select("kind,coin_id,gift_collection,virtual_gift_id").eq("profile_id", profile.id),
        supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id),
      ]);
      const firstError = coinsResult.error || watchlistResult.error || cartResult.error;
      if (firstError) throw firstError;
      return NextResponse.json({
        scope,
        coins: (coinsResult.data || []).map(mapCoin),
        gifts: [], collections: [], totalGifts: 0, nextOffset: null, marketSeed: null, bootstrapRecommended: false, genesis: null,
        watchlist: {
          coinIds: (watchlistResult.data || []).filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)),
          giftCollections: (watchlistResult.data || []).filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)),
          giftIds: (watchlistResult.data || []).filter((row) => row.kind === "gift" && row.virtual_gift_id).map((row) => String(row.virtual_gift_id)),
        },
        cartIds: (cartResult.data || []).map((row) => String(row.virtual_gift_id)),
      }, { headers: { "cache-control": "private, max-age=0, must-revalidate", "server-timing": `mxm-market-coins;dur=${Date.now() - startedAt}` } });
    }

    const offset = intParam(request.nextUrl.searchParams.get("offset"), 0, 0, 100_000);
    const limit = intParam(request.nextUrl.searchParams.get("limit"), runtimeConfig.remoteConfig.marketPageSize, 12, 72);
    const suppliedSeed = request.nextUrl.searchParams.get("seed")?.trim();
    const marketSeed = suppliedSeed && /^[a-zA-Z0-9_-]{8,80}$/.test(suppliedSeed) ? suppliedSeed : crypto.randomBytes(18).toString("base64url");

    // Infinite-scroll requests only need the next cards. Avoid watchlist/cart,
    // collection analytics, genesis and COUNT(*) on every page.
    if (offset > 0 || request.nextUrl.searchParams.get("lean") === "1") {
      const giftsResult = await supabase.rpc("gift_market_random_page", { p_seed: marketSeed, p_offset: offset, p_limit: Math.min(72, limit + 1) });
      if (giftsResult.error) throw giftsResult.error;
      const rows = (giftsResult.data || []) as Array<Record<string, unknown>>;
      const hasMore = rows.length > limit;
      const rawGifts = hasMore ? rows.slice(0, limit) : rows;
      return NextResponse.json({
        gifts: rawGifts.map(mapGift),
        nextOffset: hasMore ? offset + rawGifts.length : null,
        marketSeed,
      }, { headers: { "cache-control": "private, max-age=0, must-revalidate", "server-timing": `mxm-market-lean;dur=${Date.now() - startedAt}` } });
    }

    const profile = await requireProfile();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [giftsResult, countResult, collectionsResult, watchlistResult, cartResult, genesisResult, filterOptionsResult] = await Promise.all([
      supabase.rpc("gift_market_random_page", { p_seed: marketSeed, p_offset: 0, p_limit: limit }),
      supabase.rpc("gift_market_listed_count"),
      supabase.from("gift_collection_overview").select("base_name,item_count,holder_count,listed_count,floor_price,last_sale_price,volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct,all_time_volume,total_sales,high_sale,external_floor").order("volume_24h", { ascending: false }).limit(80),
      supabase.from("user_watchlist").select("kind,coin_id,gift_collection,virtual_gift_id").eq("profile_id", profile.id),
      supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id),
      supabase.rpc("gift_genesis_public_state"),
      supabase.rpc("gift_market_filter_options_v046"),
    ]);
    const filterMissing = filterOptionsResult.error && (filterOptionsResult.error.code === "42883" || /gift_market_filter_options_v046|schema cache|could not find the function/i.test(filterOptionsResult.error.message || ""));
    const firstError = giftsResult.error || countResult.error || collectionsResult.error || watchlistResult.error || cartResult.error || genesisResult.error || (filterMissing ? null : filterOptionsResult.error);
    if (firstError) throw firstError;

    const rawGifts = (giftsResult.data || []) as Array<Record<string, unknown>>;
    const totalGifts = Number(countResult.data || 0);
    const nextOffset = rawGifts.length < totalGifts ? rawGifts.length : null;
    return NextResponse.json({
      scope,
      coins: [],
      gifts: rawGifts.map(mapGift),
      collections: (collectionsResult.data || []).map((row) => mapCollection(row as Record<string, unknown>)),
      totalGifts,
      nextOffset,
      marketSeed,
      bootstrapRecommended: totalGifts === 0,
      genesis: genesisResult.data || null,
      filterOptions: filterOptionsResult.data || { collections: [], models: [], backdrops: [], symbols: [] },
      watchlist: {
        coinIds: (watchlistResult.data || []).filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)),
        giftCollections: (watchlistResult.data || []).filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)),
        giftIds: (watchlistResult.data || []).filter((row) => row.kind === "gift" && row.virtual_gift_id).map((row) => String(row.virtual_gift_id)),
      },
      cartIds: (cartResult.data || []).map((row) => String(row.virtual_gift_id)),
    }, { headers: { "cache-control": "private, max-age=0, must-revalidate", "server-timing": `mxm-market;dur=${Date.now() - startedAt}` } });
  } catch (error) {
    console.error("market", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить рынок" }, { status: 500 });
  }
}
