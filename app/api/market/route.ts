import { apiFailure, withApiErrors } from "@/lib/api-route";
import crypto from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { readSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin, mapGift, mapGiftCollection } from "@/lib/mappers";
import { maybeMaintainGiftMarket } from "@/lib/market/maintenance";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 60;
export const revalidate = 10;

const coinMarketSelect = "id,creator_profile_id,name,symbol,description,current_price,market_cap,status,created_at,total_supply,token_reserve,quote_reserve,volume_24h,change_24h,holder_count,trade_count_24h,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,image_url";

type SharedMarketCache<T> = { expiresAt: number; value: T };

let filterOptionsCache: SharedMarketCache<unknown> | null = null;
let filterOptionsInFlight: Promise<unknown> | null = null;
let collectionOverviewCache: SharedMarketCache<Array<Record<string, unknown>>> | null = null;
let collectionOverviewInFlight: Promise<Array<Record<string, unknown>>> | null = null;

async function getCachedGiftFilterOptions() {
  const now = Date.now();
  if (filterOptionsCache && filterOptionsCache.expiresAt > now) return filterOptionsCache.value;
  if (filterOptionsInFlight) return filterOptionsInFlight;
  filterOptionsInFlight = (async () => {
    const result = await getSupabaseAdmin().rpc("gift_market_filter_options_v046");
    if (result.error) throw result.error;
    const value = result.data ?? { collections: [], models: [], backdrops: [], symbols: [] };
    filterOptionsCache = { expiresAt: Date.now() + 60_000, value };
    return value;
  })();
  try { return await filterOptionsInFlight; }
  finally { filterOptionsInFlight = null; }
}

async function getCachedGiftCollectionOverview() {
  const now = Date.now();
  if (collectionOverviewCache && collectionOverviewCache.expiresAt > now) return collectionOverviewCache.value;
  if (collectionOverviewInFlight) return collectionOverviewInFlight;
  collectionOverviewInFlight = (async () => {
    const result = await getSupabaseAdmin().from("gift_collection_overview")
      .select("base_name,item_count,holder_count,listed_count,floor_price,last_sale_price,volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct,all_time_volume,total_sales,high_sale,external_floor")
      .order("volume_24h", { ascending: false })
      .limit(24);
    if (result.error) throw result.error;
    const value = (result.data || []) as unknown as Array<Record<string, unknown>>;
    collectionOverviewCache = { expiresAt: Date.now() + 5_000, value };
    return value;
  })();
  try { return await collectionOverviewInFlight; }
  finally { collectionOverviewInFlight = null; }
}

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function filterParam(value: string | null) {
  const normalized = value?.trim();
  return normalized && normalized.length <= 120 ? normalized : null;
}

function enumParam<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && allowed.includes(value as T) ? value as T : fallback;
}

type GiftMarketPage = {
  gifts?: Array<Record<string, unknown>>;
  totalGifts?: number;
  nextOffset?: number | null;
};

function parseGiftMarketPage(value: unknown): Required<GiftMarketPage> {
  const page = value && typeof value === "object" ? value as GiftMarketPage : {};
  const gifts = Array.isArray(page.gifts) ? page.gifts : [];
  const totalGifts = Math.max(0, Number(page.totalGifts) || 0);
  const parsedNext = page.nextOffset == null ? null : Number(page.nextOffset);
  return {
    gifts,
    totalGifts,
    nextOffset: parsedNext != null && Number.isInteger(parsedNext) && parsedNext >= 0 ? parsedNext : null,
  };
}


async function GETHandler(request: NextRequest) {
  const startedAt = Date.now();
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const scope = request.nextUrl.searchParams.get("scope") === "coins" ? "coins" : "gifts";
  const runtimeConfig = await getRuntimeConfig().catch((error) => { console.error("market runtime config", error); return null; });
  if (!runtimeConfig) return NextResponse.json({ error: "Конфигурация рынка недоступна" }, { status: 503 });
  if (scope === "coins" && !runtimeConfig.featureFlags.memecoins) return NextResponse.json({ error: "Мемкоины временно отключены" }, { status: 503 });
  if (scope === "gifts" && !runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });

  // Expiry is already enforced in every market view/RPC. Cleanup therefore
  // happens after the response and can never extend first paint latency.
  if (scope === "gifts") after(() => maybeMaintainGiftMarket());

  try {
    if (scope === "coins") {
      const profile = await requireProfile();
      if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
      const [coinsResult, newCoinsResult, boostsResult, watchlistResult, cartResult] = await Promise.all([
        supabase.from("market_overview").select(coinMarketSelect).eq("status", "active").order("volume_24h", { ascending: false }).order("created_at", { ascending: false }).limit(72),
        // Discovery must not be derived from the volume leaderboard: a freshly
        // launched coin can legitimately have no trades yet.
        supabase.from("market_overview").select(coinMarketSelect).eq("status", "active").order("created_at", { ascending: false }).limit(48),
        supabase.from("active_coin_boosts_v200").select("coin_id,boosted_until").order("boosted_until", { ascending: false }).limit(48),
        supabase.from("user_watchlist").select("kind,coin_id,gift_collection,virtual_gift_id").eq("profile_id", profile.id),
        supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id),
      ]);
      const firstError = coinsResult.error || newCoinsResult.error || boostsResult.error || watchlistResult.error || cartResult.error;
      if (firstError) throw firstError;
      const boostRows = boostsResult.data || [];
      const boostByCoin = new Map<string, string>(boostRows.map((row) => [String(row.coin_id), String(row.boosted_until)] as [string, string]));
      const boostedCoinIds = [...boostByCoin.keys()];
      let boostedCoinRows: Record<string, unknown>[] = [];
      if (boostedCoinIds.length) {
        const boostedCoinsResult = await supabase.from("market_overview").select(coinMarketSelect).eq("status", "active").in("id", boostedCoinIds);
        if (boostedCoinsResult.error) throw boostedCoinsResult.error;
        boostedCoinRows = (boostedCoinsResult.data || []) as Record<string, unknown>[];
      }
      const mapMarketCoin = (row: Record<string, unknown>) => {
        const coin = mapCoin(row);
        return { ...coin, boostedUntil: boostByCoin.get(coin.id) || null };
      };
      const newestCoins = (newCoinsResult.data || []).map((row) => mapMarketCoin(row as Record<string, unknown>));
      const promotedCoins = boostedCoinRows
        .map(mapMarketCoin)
        .sort((a, b) => (Date.parse(b.boostedUntil || "") || 0) - (Date.parse(a.boostedUntil || "") || 0));
      const seenNewest = new Set<string>();
      return NextResponse.json({
        scope,
        coins: (coinsResult.data || []).map((row) => mapMarketCoin(row as Record<string, unknown>)),
        newCoins: [...promotedCoins, ...newestCoins].filter((coin) => {
          if (seenNewest.has(coin.id)) return false;
          seenNewest.add(coin.id);
          return true;
        }).slice(0, 48),
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
    const giftPageArgs = {
      p_seed: marketSeed,
      p_offset: offset,
      p_limit: limit,
      p_collection: filterParam(request.nextUrl.searchParams.get("collection")),
      p_model: filterParam(request.nextUrl.searchParams.get("model")),
      p_backdrop: filterParam(request.nextUrl.searchParams.get("backdrop")),
      p_symbol: filterParam(request.nextUrl.searchParams.get("symbol")),
      p_price_band: enumParam(request.nextUrl.searchParams.get("priceBand"), ["all", "under50", "50to250", "250to1000", "over1000"] as const, "all"),
      p_view: enumParam(request.nextUrl.searchParams.get("view"), ["all", "deals", "rare", "new", "offers"] as const, "all"),
      p_sort: enumParam(request.nextUrl.searchParams.get("sort"), ["random", "price", "newest", "number", "rarity", "offers"] as const, "random"),
    };
    const hasCatalogFilters = Boolean(
      giftPageArgs.p_collection || giftPageArgs.p_model || giftPageArgs.p_backdrop || giftPageArgs.p_symbol
      || giftPageArgs.p_price_band !== "all" || giftPageArgs.p_view !== "all" || giftPageArgs.p_sort !== "random"
    );

    // Infinite-scroll requests only need the next cards. Avoid watchlist/cart,
    // collection analytics, genesis and COUNT(*) on every page.
    if (offset > 0 || request.nextUrl.searchParams.get("lean") === "1") {
      const giftsResult = await supabase.rpc("gift_market_filtered_page_v200", giftPageArgs);
      if (giftsResult.error) throw giftsResult.error;
      const page = parseGiftMarketPage(giftsResult.data);
      return NextResponse.json({
        gifts: page.gifts.map(mapGift),
        totalGifts: page.totalGifts,
        nextOffset: page.nextOffset,
        marketSeed,
      }, { headers: { "cache-control": "private, max-age=0, must-revalidate", "server-timing": `mxm-market-lean;dur=${Date.now() - startedAt}` } });
    }

    const profile = await requireProfile();
    if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });

    const [giftsResult, collectionRows, watchlistResult, cartResult, genesisResult, liquidityResult, filterOptions] = await Promise.all([
      supabase.rpc("gift_market_filtered_page_v200", giftPageArgs),
      getCachedGiftCollectionOverview(),
      supabase.from("user_watchlist").select("kind,coin_id,gift_collection,virtual_gift_id").eq("profile_id", profile.id),
      supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id),
      supabase.rpc("gift_genesis_public_state"),
      supabase.rpc("gift_market_liquidity_state"),
      getCachedGiftFilterOptions(),
    ]);
    const firstError = giftsResult.error || watchlistResult.error || cartResult.error || genesisResult.error || liquidityResult.error;
    if (firstError) throw firstError;

    const page = parseGiftMarketPage(giftsResult.data);
    return NextResponse.json({
      scope,
      coins: [],
      newCoins: [],
      gifts: page.gifts.map(mapGift),
      collections: collectionRows.map((row) => mapGiftCollection(row)),
      totalGifts: page.totalGifts,
      nextOffset: page.nextOffset,
      marketSeed,
      bootstrapRecommended: page.totalGifts === 0 && !hasCatalogFilters && !Boolean((liquidityResult.data as { playerOnly?: boolean } | null)?.playerOnly),
      genesis: genesisResult.data || null,
      liquidity: liquidityResult.data || null,
      filterOptions,
      watchlist: {
        coinIds: (watchlistResult.data || []).filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)),
        giftCollections: (watchlistResult.data || []).filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)),
        giftIds: (watchlistResult.data || []).filter((row) => row.kind === "gift" && row.virtual_gift_id).map((row) => String(row.virtual_gift_id)),
      },
      cartIds: (cartResult.data || []).map((row) => String(row.virtual_gift_id)),
    }, { headers: { "cache-control": "private, max-age=0, must-revalidate", "server-timing": `mxm-market;dur=${Date.now() - startedAt}` } });
  } catch (error) {
    console.error("market", error);
    return apiFailure(error, "Не удалось загрузить рынок");
  }
}
export const GET = withApiErrors("app/api/market/route.ts:GET", GETHandler);
