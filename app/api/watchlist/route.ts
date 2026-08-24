import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { after, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { giftMarketSelect, mapCoin, mapGift } from "@/lib/mappers";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { finiteNumber, nullableNumber, text } from "@/lib/safe-data";

function mapCollection(row: Record<string, unknown>) {
  const baseName = text(row.base_name, "", 160);
  if (!baseName) return null;
  return {
    baseName,
    itemCount: Math.max(0, finiteNumber(row.item_count)),
    holderCount: Math.max(0, finiteNumber(row.holder_count)),
    listedCount: Math.max(0, finiteNumber(row.listed_count)),
    floorPrice: nullableNumber(row.floor_price),
    lastSalePrice: nullableNumber(row.last_sale_price),
    volume24h: Math.max(0, finiteNumber(row.volume_24h)),
    change24h: finiteNumber(row.change_24h),
    tradeCount24h: Math.max(0, finiteNumber(row.trade_count_24h)),
    volume7d: Math.max(0, finiteNumber(row.volume_7d)),
    tradeCount7d: Math.max(0, finiteNumber(row.trade_count_7d)),
    listedPct: Math.max(0, finiteNumber(row.listed_pct)),
    allTimeVolume: Math.max(0, finiteNumber(row.all_time_volume)),
    totalSales: Math.max(0, finiteNumber(row.total_sales)),
    highSale: nullableNumber(row.high_sale),
    externalFloor: nullableNumber(row.external_floor),
  };
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const profileId = String(profile.id);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("user_watchlist").select("kind,coin_id,gift_collection,virtual_gift_id,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(500);
  if (error) return apiFailure(error, "Не удалось загрузить избранное");
  const rows = data || [];
  const coinIds = [...new Set(rows.filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)))];
  const giftCollections = [...new Set(rows.filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)))];
  const giftIds = [...new Set(rows.filter((row) => row.kind === "gift" && row.virtual_gift_id).map((row) => String(row.virtual_gift_id)))];

  const [config, premiumResult] = await Promise.all([
    getRuntimeConfig(),
    supabase.from("profiles").select("premium_until").eq("id", profile.id).maybeSingle(),
  ]);
  if (premiumResult.error) return apiFailure(premiumResult.error, "Не удалось загрузить лимит избранного");
  const premiumActive = Boolean(premiumResult.data?.premium_until && new Date(String(premiumResult.data.premium_until)).getTime() > Date.now());
  const watchlistLimit = config.remoteConfig.maxWatchlistItems * (premiumActive ? 2 : 1);

  const [coinsResult, collectionsResult, giftsResult, alertsResult] = await Promise.all([
    coinIds.length ? supabase.from("market_overview").select("id,creator_profile_id,name,symbol,image_url,description,current_price,market_cap,volume_24h,change_24h,holder_count,trade_count_24h,created_at,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,total_supply,token_reserve,quote_reserve").in("id", coinIds) : Promise.resolve({ data: [], error: null }),
    giftCollections.length ? supabase.from("gift_collection_overview").select("base_name,item_count,holder_count,listed_count,floor_price,last_sale_price,volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct,all_time_volume,total_sales,high_sale,external_floor").in("base_name", giftCollections) : Promise.resolve({ data: [], error: null }),
    giftIds.length ? supabase.from("gift_market_overview").select(giftMarketSelect).in("virtual_gift_id", giftIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("price_alerts").select("id,kind,coin_id,virtual_gift_id,gift_collection,direction,target_price,enabled,last_triggered_at,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(120),
  ]);
  const firstError = coinsResult.error || collectionsResult.error || giftsResult.error || alertsResult.error;
  if (firstError) return apiFailure(firstError, "Не удалось загрузить данные избранного");

  const coins = (coinsResult.data || []).map(mapCoin).sort((a, b) => coinIds.indexOf(a.id) - coinIds.indexOf(b.id));
  const collections = (collectionsResult.data || []).flatMap((row) => { const mapped = mapCollection(row as Record<string, unknown>); return mapped ? [mapped] : []; }).sort((a, b) => giftCollections.indexOf(a.baseName) - giftCollections.indexOf(b.baseName));
  const gifts = (giftsResult.data || []).map(mapGift).sort((a, b) => giftIds.indexOf(a.virtualGiftId) - giftIds.indexOf(b.virtualGiftId));

  const validCoinIds = new Set(coins.map((coin) => coin.id));
  const validCollections = new Set(collections.map((collection) => collection.baseName));
  const validGiftIds = new Set(gifts.map((gift) => gift.virtualGiftId));
  const cleanCoinIds = coinIds.filter((id) => validCoinIds.has(id));
  const cleanCollections = giftCollections.filter((name) => validCollections.has(name));
  const cleanGiftIds = giftIds.filter((id) => validGiftIds.has(id));
  const staleCoinIds = coinIds.filter((id) => !validCoinIds.has(id));
  const staleCollections = giftCollections.filter((name) => !validCollections.has(name));
  const staleGiftIds = giftIds.filter((id) => !validGiftIds.has(id));

  if (staleCoinIds.length || staleCollections.length || staleGiftIds.length) {
    after(async () => {
      const cleanup = getSupabaseAdmin();
      try {
        if (staleCoinIds.length) {
          const result = await cleanup.from("user_watchlist").delete().eq("profile_id", profileId).eq("kind", "coin").in("coin_id", staleCoinIds);
          if (result.error) console.error("watchlist stale coin cleanup", result.error);
        }
        if (staleCollections.length) {
          const result = await cleanup.from("user_watchlist").delete().eq("profile_id", profileId).eq("kind", "gift_collection").in("gift_collection", staleCollections);
          if (result.error) console.error("watchlist stale collection cleanup", result.error);
        }
        if (staleGiftIds.length) {
          const result = await cleanup.from("user_watchlist").delete().eq("profile_id", profileId).eq("kind", "gift").in("virtual_gift_id", staleGiftIds);
          if (result.error) console.error("watchlist stale gift cleanup", result.error);
        }
      } catch (cause) {
        console.error("watchlist stale cleanup", cause);
      }
    });
  }

  return NextResponse.json({
    watchlist: { coinIds: cleanCoinIds, giftCollections: cleanCollections, giftIds: cleanGiftIds },
    coins,
    collections,
    gifts,
    alerts: (alertsResult.data || []).map((row) => ({ id: String(row.id), kind: row.kind, coinId: row.coin_id || null, giftId: row.virtual_gift_id || null, giftCollection: row.gift_collection || null, direction: row.direction, targetPrice: Math.max(0, finiteNumber(row.target_price)), enabled: Boolean(row.enabled), lastTriggeredAt: row.last_triggered_at || null, createdAt: row.created_at })),
    watchlistMeta: { used: cleanCoinIds.length + cleanCollections.length + cleanGiftIds.length, limit: watchlistLimit, premiumActive },
  });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const profileId = String(profile.id);
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "watchlist", String(profile.id), 90, 60))) return NextResponse.json({ error: "Слишком много запросов." }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const kind = body.kind === "coin" ? "coin" : body.kind === "gift_collection" ? "gift_collection" : body.kind === "gift" ? "gift" : null;
  if (!kind) return NextResponse.json({ error: "Некорректный тип избранного" }, { status: 400 });
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Некорректное состояние избранного" }, { status: 400 });
  const enabled = body.enabled;
  const supabase = getSupabaseAdmin();
  const config = await getRuntimeConfig();
  let watchlistLimit = config.remoteConfig.maxWatchlistItems;
  const premium = await supabase.from("profiles").select("premium_until").eq("id", profileId).maybeSingle();
  if (premium.error) return apiFailure(premium.error, "Не удалось проверить лимит избранного");
  if (premium.data?.premium_until && new Date(String(premium.data.premium_until)).getTime() > Date.now()) watchlistLimit *= 2;

  const coinId = kind === "coin" && typeof body.coinId === "string" ? body.coinId : null;
  const giftId = kind === "gift" && typeof body.giftId === "string" ? body.giftId : null;
  const baseName = kind === "gift_collection" && typeof body.baseName === "string" ? body.baseName.trim() : null;
  if (kind === "coin" && !validUuidLike(coinId || "")) return NextResponse.json({ error: "Некорректный ID мемкоина" }, { status: 400 });
  if (kind === "gift" && !validUuidLike(giftId || "")) return NextResponse.json({ error: "Некорректный идентификатор подарка" }, { status: 400 });
  if (kind === "gift_collection" && (!baseName || baseName.length > 160)) return NextResponse.json({ error: "Некорректная коллекция подарков" }, { status: 400 });

  const { data, error } = await supabase.rpc("set_watchlist_v200", {
    p_profile_id: profileId,
    p_kind: kind,
    p_enabled: enabled,
    p_limit: watchlistLimit,
    p_coin_id: coinId,
    p_gift_collection: baseName,
    p_virtual_gift_id: giftId,
  });
  if (error) {
    console.error("watchlist mutation", error);
    const limit = /watchlist limit reached/i.test(error.message || "");
    const notFound = /not found/i.test(error.message || "");
    if (!limit && !notFound) return apiFailure(error, "Не удалось изменить избранное");
    return NextResponse.json({ error: limit ? `Лимит избранного: ${watchlistLimit}` : "Актив не найден" }, { status: limit ? 409 : 404 });
  }
  return NextResponse.json(data || { enabled });
}
export const GET = withApiErrors("app/api/watchlist/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/watchlist/route.ts:POST", POSTHandler);
