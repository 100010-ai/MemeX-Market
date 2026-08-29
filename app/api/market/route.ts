import { apiFailure, withApiErrors } from "@/lib/api-route";
import crypto from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { requireProfile, requireSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin, mapGift, mapGiftCollection } from "@/lib/mappers";
import { maybeMaintainGiftMarket } from "@/lib/market/maintenance";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 60;
export const revalidate = 10;

const coinMarketSelect = "id,creator_profile_id,name,symbol,description,current_price,market_cap,status,created_at,total_supply,token_reserve,quote_reserve,volume_24h,change_24h,holder_count,trade_count_24h,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,image_url,unique_traders_24h,unique_traders_all,top_trader_share_bps,heat_score,heat_tier,coin_level,coin_level_key,last_public_trade_at";
const OPTIONAL_MARKET_QUERY_TIMEOUT_MS = 1_500;

type GiftMarketPage = {
  gifts?: Array<Record<string, unknown>>;
  totalGifts?: number;
  nextOffset?: number | null;
};

type GiftMarketBootstrapMeta = {
  collections?: Array<Record<string, unknown>>;
  watchlist?: {
    coinIds?: unknown[];
    giftCollections?: unknown[];
    giftIds?: unknown[];
  };
  cartIds?: unknown[];
  genesis?: unknown;
  liquidity?: unknown;
  filterOptions?: unknown;
};

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapDiscoveryCoin(row: Record<string, unknown>, boostedUntil: string | null = null) {
  const coin = mapCoin(row);
  const heatTier = typeof row.heat_tier === "string" ? row.heat_tier : "quiet";
  const levelKey = typeof row.coin_level_key === "string" ? row.coin_level_key : "launch";
  return {
    ...coin,
    boostedUntil,
    heatScore: Math.min(100, Math.max(0, Math.floor(finite(row.heat_score)))),
    heatTier,
    coinLevel: Math.min(5, Math.max(1, Math.floor(finite(row.coin_level, 1)))),
    coinLevelKey: levelKey,
    uniqueTraders24h: Math.max(0, Math.floor(finite(row.unique_traders_24h))),
    uniqueTradersAll: Math.max(0, Math.floor(finite(row.unique_traders_all))),
    topTraderShareBps: Math.min(10_000, Math.max(0, Math.floor(finite(row.top_trader_share_bps)))),
    lastPublicTradeAt: typeof row.last_public_trade_at === "string" ? row.last_public_trade_at : null,
  };
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

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "")).filter(Boolean) : [];
}

function parseGiftMeta(value: unknown): GiftMarketBootstrapMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as GiftMarketBootstrapMeta;
}

async function settleWithin<T>(promise: PromiseLike<T>, timeoutMs = OPTIONAL_MARKET_QUERY_TIMEOUT_MS): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function optionalQueryWarning(name: string, result: { error?: unknown } | null) {
  if (!result) {
    console.warn(`market optional query timed out: ${name}`);
    return;
  }
  if (result.error) console.warn(`market optional query failed: ${name}`, result.error);
}

async function GETHandler(request: NextRequest) {
  const startedAt = Date.now();
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const scope = request.nextUrl.searchParams.get("scope") === "coins" ? "coins" : "gifts";
  const runtimeConfig = await getRuntimeConfig().catch((error) => { console.error("market runtime config", error); return null; });
  if (!runtimeConfig) return NextResponse.json({ error: "Конфигурация рынка недоступна" }, { status: 503 });
  if (scope === "coins" && !runtimeConfig.featureFlags.memecoins) return NextResponse.json({ error: "Мемкоины временно отключены" }, { status: 503 });
  if (scope === "gifts" && !runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });

  if (scope === "gifts") after(() => maybeMaintainGiftMarket());

  try {
    if (scope === "coins") {
      const coinLimit = intParam(request.nextUrl.searchParams.get("limit"), 72, 6, 72);
      const compact = request.nextUrl.searchParams.get("compact") === "1";
      if (compact) {
        const coinsResult = await supabase.from("coin_discovery_v0730")
          .select(coinMarketSelect)
          .eq("status", "active")
          .order("heat_score", { ascending: false })
          .order("volume_24h", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(coinLimit);
        if (coinsResult.error) throw coinsResult.error;
        return NextResponse.json({
          scope,
          coins: (coinsResult.data || []).map((row) => mapDiscoveryCoin(row as Record<string, unknown>)),
        }, { headers: { "cache-control": "private, max-age=0, must-revalidate", "server-timing": `mxm-market-coins-compact;dur=${Date.now() - startedAt}` } });
      }

      const profile = await requireProfile();
      if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
      const newCoinLimit = Math.min(48, Math.max(12, coinLimit));
      const [coinsResult, newCoinsResult, boostsResult, watchlistResult] = await Promise.all([
        supabase.from("coin_discovery_v0730").select(coinMarketSelect).eq("status", "active").order("heat_score", { ascending: false }).order("volume_24h", { ascending: false }).order("created_at", { ascending: false }).limit(coinLimit),
        settleWithin(supabase.from("coin_discovery_v0730").select(coinMarketSelect).eq("status", "active").order("created_at", { ascending: false }).limit(newCoinLimit)),
        settleWithin(supabase.from("active_coin_boosts_v200").select("coin_id,boosted_until").order("boosted_until", { ascending: false }).limit(newCoinLimit)),
        settleWithin(supabase.from("user_watchlist").select("kind,coin_id,gift_collection,virtual_gift_id").eq("profile_id", profile.id).limit(500)),
      ]);
      if (coinsResult.error) throw coinsResult.error;
      optionalQueryWarning("new coins", newCoinsResult);
      optionalQueryWarning("coin boosts", boostsResult);
      optionalQueryWarning("coin watchlist", watchlistResult);

      const boostRows = boostsResult && !boostsResult.error ? boostsResult.data || [] : [];
      const boostByCoin = new Map<string, string>(boostRows.map((row) => [String(row.coin_id), String(row.boosted_until)] as [string, string]));
      const boostedCoinIds = [...boostByCoin.keys()];
      let boostedCoinRows: Record<string, unknown>[] = [];
      if (boostedCoinIds.length) {
        const boostedCoinsResult = await settleWithin(supabase.from("coin_discovery_v0730").select(coinMarketSelect).eq("status", "active").in("id", boostedCoinIds));
        optionalQueryWarning("boosted coin hydration", boostedCoinsResult);
        if (boostedCoinsResult && !boostedCoinsResult.error) boostedCoinRows = (boostedCoinsResult.data || []) as Record<string, unknown>[];
      }

      const mapMarketCoin = (row: Record<string, unknown>) => mapDiscoveryCoin(row, boostByCoin.get(String(row.id || "")) || null);
      const baseCoins = (coinsResult.data || []).map((row) => mapMarketCoin(row as Record<string, unknown>));
      const newestCoins = newCoinsResult && !newCoinsResult.error
        ? (newCoinsResult.data || []).map((row) => mapMarketCoin(row as Record<string, unknown>))
        : [...baseCoins].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, newCoinLimit);
      const promotedCoins = boostedCoinRows
        .map(mapMarketCoin)
        .sort((a, b) => (Date.parse(b.boostedUntil || "") || 0) - (Date.parse(a.boostedUntil || "") || 0));
      const seenNewest = new Set<string>();
      const watchRows = watchlistResult && !watchlistResult.error ? watchlistResult.data || [] : [];

      return NextResponse.json({
        scope,
        coins: baseCoins,
        newCoins: [...promotedCoins, ...newestCoins].filter((coin) => {
          if (seenNewest.has(coin.id)) return false;
          seenNewest.add(coin.id);
          return true;
        }).slice(0, newCoinLimit),
        gifts: [], collections: [], totalGifts: 0, nextOffset: null, marketSeed: null, bootstrapRecommended: false, genesis: null,
        watchlist: {
          coinIds: watchRows.filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)),
          giftCollections: watchRows.filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)),
          giftIds: watchRows.filter((row) => row.kind === "gift" && row.virtual_gift_id).map((row) => String(row.virtual_gift_id)),
        },
        cartIds: [],
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

    const [giftsResult, metaResult] = await Promise.all([
      supabase.rpc("gift_market_filtered_page_v200", giftPageArgs),
      settleWithin(supabase.rpc("gift_market_bootstrap_meta_v0795", { p_profile_id: profile.id })),
    ]);
    if (giftsResult.error) throw giftsResult.error;
    optionalQueryWarning("gift bootstrap metadata", metaResult);

    const page = parseGiftMarketPage(giftsResult.data);
    const meta = metaResult && !metaResult.error ? parseGiftMeta(metaResult.data) : null;
    const collectionRows = Array.isArray(meta?.collections) ? meta.collections : [];
    const watchlist = meta?.watchlist && typeof meta.watchlist === "object" ? meta.watchlist : {};
    const liquidity = meta?.liquidity && typeof meta.liquidity === "object" && !Array.isArray(meta.liquidity)
      ? meta.liquidity as { playerOnly?: boolean }
      : null;
    const metaState = meta ? "ok" : "degraded";

    return NextResponse.json({
      scope,
      coins: [],
      newCoins: [],
      gifts: page.gifts.map(mapGift),
      collections: collectionRows.map((row) => mapGiftCollection(row)),
      totalGifts: page.totalGifts,
      nextOffset: page.nextOffset,
      marketSeed,
      bootstrapRecommended: Boolean(meta) && page.totalGifts < 24 && !hasCatalogFilters && !Boolean(liquidity?.playerOnly),
      genesis: meta?.genesis || null,
      liquidity: meta?.liquidity || null,
      filterOptions: meta?.filterOptions || { collections: [], models: [], backdrops: [], symbols: [] },
      watchlist: {
        coinIds: stringList(watchlist.coinIds),
        giftCollections: stringList(watchlist.giftCollections),
        giftIds: stringList(watchlist.giftIds),
      },
      cartIds: stringList(meta?.cartIds),
    }, { headers: {
      "cache-control": "private, max-age=0, must-revalidate",
      "server-timing": `mxm-market;dur=${Date.now() - startedAt}`,
      "x-mxm-market-meta": metaState,
    } });
  } catch (error) {
    console.error("market", error);
    return apiFailure(error, "Не удалось загрузить рынок");
  }
}
export const GET = withApiErrors("app/api/market/route.ts:GET", GETHandler);
