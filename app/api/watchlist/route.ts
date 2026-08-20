import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { giftMarketSelect, mapCoin, mapGift } from "@/lib/mappers";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { validUuidLike } from "@/lib/security";

function mapCollection(row: Record<string, unknown>) {
  return {
    baseName: String(row.base_name),
    itemCount: Number(row.item_count || 0),
    holderCount: Number(row.holder_count || 0),
    listedCount: Number(row.listed_count || 0),
    floorPrice: row.floor_price == null ? null : Number(row.floor_price),
    lastSalePrice: row.last_sale_price == null ? null : Number(row.last_sale_price),
    volume24h: Number(row.volume_24h || 0),
    change24h: Number(row.change_24h || 0),
    tradeCount24h: Number(row.trade_count_24h || 0),
    volume7d: Number(row.volume_7d || 0),
    tradeCount7d: Number(row.trade_count_7d || 0),
    listedPct: Number(row.listed_pct || 0),
    allTimeVolume: Number(row.all_time_volume || 0),
    totalSales: Number(row.total_sales || 0),
    highSale: row.high_sale == null ? null : Number(row.high_sale),
    externalFloor: row.external_floor == null ? null : Number(row.external_floor),
  };
}

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("user_watchlist").select("kind,coin_id,gift_collection,virtual_gift_id,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data || [];
  const coinIds = rows.filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id));
  const giftCollections = rows.filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection));
  const giftIds = rows.filter((row) => row.kind === "gift" && row.virtual_gift_id).map((row) => String(row.virtual_gift_id));

  const [coinsResult, collectionsResult, giftsResult, alertsResult] = await Promise.all([
    coinIds.length ? supabase.from("market_overview").select("id,creator_profile_id,name,symbol,image_url,description,current_price,market_cap,volume_24h,change_24h,holder_count,trade_count_24h,created_at,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,total_supply,token_reserve,quote_reserve").in("id", coinIds) : Promise.resolve({ data: [], error: null }),
    giftCollections.length ? supabase.from("gift_collection_overview").select("base_name,item_count,holder_count,listed_count,floor_price,last_sale_price,volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct,all_time_volume,total_sales,high_sale,external_floor").in("base_name", giftCollections) : Promise.resolve({ data: [], error: null }),
    giftIds.length ? supabase.from("gift_market_overview").select(giftMarketSelect).in("virtual_gift_id", giftIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("price_alerts").select("id,kind,coin_id,virtual_gift_id,gift_collection,direction,target_price,enabled,last_triggered_at,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }),
  ]);
  const firstError = coinsResult.error || collectionsResult.error || giftsResult.error || alertsResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  const coins = (coinsResult.data || []).map(mapCoin).sort((a, b) => coinIds.indexOf(a.id) - coinIds.indexOf(b.id));
  const collections = (collectionsResult.data || []).map((row) => mapCollection(row as Record<string, unknown>)).sort((a, b) => giftCollections.indexOf(a.baseName) - giftCollections.indexOf(b.baseName));
  const gifts = (giftsResult.data || []).map(mapGift).sort((a, b) => giftIds.indexOf(a.virtualGiftId) - giftIds.indexOf(b.virtualGiftId));

  return NextResponse.json({
    watchlist: { coinIds, giftCollections, giftIds },
    coins,
    collections,
    gifts,
    alerts: (alertsResult.data || []).map((row) => ({ id: String(row.id), kind: row.kind, coinId: row.coin_id || null, giftId: row.virtual_gift_id || null, giftCollection: row.gift_collection || null, direction: row.direction, targetPrice: Number(row.target_price), enabled: Boolean(row.enabled), lastTriggeredAt: row.last_triggered_at || null, createdAt: row.created_at })),
  });
}

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const profileId = String(profile.id);
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "watchlist", String(profile.id), 90, 60))) return NextResponse.json({ error: "Слишком много запросов." }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const kind = body.kind === "coin" ? "coin" : body.kind === "gift_collection" ? "gift_collection" : body.kind === "gift" ? "gift" : null;
  const enabled = body.enabled === true;
  if (!kind) return NextResponse.json({ error: "Некорректный тип избранного" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const config = enabled ? await getRuntimeConfig() : null;
  async function watchlistLimitError() {
    if (!config) return null;
    const { count, error } = await supabase.from("user_watchlist").select("id", { count: "exact", head: true }).eq("profile_id", profileId);
    if (error) return { status: 500, message: error.message };
    if (Number(count || 0) >= config.remoteConfig.maxWatchlistItems) return { status: 409, message: `Лимит избранного: ${config.remoteConfig.maxWatchlistItems}` };
    return null;
  }

  if (kind === "coin") {
    const coinId = typeof body.coinId === "string" ? body.coinId : "";
    if (!validUuidLike(coinId)) return NextResponse.json({ error: "Некорректный ID мемкоина" }, { status: 400 });
    const { data: coin, error: coinError } = await supabase.from("coins").select("id").eq("id", coinId).eq("status", "active").maybeSingle();
    if (coinError) return NextResponse.json({ error: coinError.message }, { status: 500 });
    if (!coin) return NextResponse.json({ error: "Мемкоин не найден" }, { status: 404 });
    if (enabled) {
      const { data: existing, error: existingError } = await supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "coin").eq("coin_id", coinId).maybeSingle();
      if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
      if (!existing) {
        const limitError = await watchlistLimitError();
        if (limitError) return NextResponse.json({ error: limitError.message }, { status: limitError.status });
        const { error } = await supabase.from("user_watchlist").insert({ profile_id: profile.id, kind: "coin", coin_id: coinId, gift_collection: null, virtual_gift_id: null });
        if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase.from("user_watchlist").delete().eq("profile_id", profile.id).eq("kind", "coin").eq("coin_id", coinId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ enabled });
  }

  if (kind === "gift") {
    const giftId = typeof body.giftId === "string" ? body.giftId : "";
    if (!validUuidLike(giftId)) return NextResponse.json({ error: "Некорректный ID Gift" }, { status: 400 });
    const { data: gift, error: giftError } = await supabase.from("virtual_gifts").select("id").eq("id", giftId).maybeSingle();
    if (giftError) return NextResponse.json({ error: giftError.message }, { status: 500 });
    if (!gift) return NextResponse.json({ error: "Gift не найден" }, { status: 404 });
    if (enabled) {
      const { data: existing, error: existingError } = await supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "gift").eq("virtual_gift_id", giftId).maybeSingle();
      if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
      if (!existing) {
        const limitError = await watchlistLimitError();
        if (limitError) return NextResponse.json({ error: limitError.message }, { status: limitError.status });
        const { error } = await supabase.from("user_watchlist").insert({ profile_id: profile.id, kind: "gift", coin_id: null, gift_collection: null, virtual_gift_id: giftId });
        if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase.from("user_watchlist").delete().eq("profile_id", profile.id).eq("kind", "gift").eq("virtual_gift_id", giftId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ enabled });
  }

  const baseName = typeof body.baseName === "string" ? body.baseName.trim() : "";
  if (!baseName) return NextResponse.json({ error: "Не выбрана коллекция подарков" }, { status: 400 });
  const { data: collection, error: collectionError } = await supabase.from("gift_collection_overview").select("base_name").eq("base_name", baseName).maybeSingle();
  if (collectionError) return NextResponse.json({ error: collectionError.message }, { status: 500 });
  if (!collection) return NextResponse.json({ error: "Коллекция подарков не найдена" }, { status: 404 });
  if (enabled) {
    const { data: existing, error: existingError } = await supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "gift_collection").eq("gift_collection", baseName).maybeSingle();
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    if (!existing) {
      const limitError = await watchlistLimitError();
      if (limitError) return NextResponse.json({ error: limitError.message }, { status: limitError.status });
      const { error } = await supabase.from("user_watchlist").insert({ profile_id: profile.id, kind: "gift_collection", coin_id: null, gift_collection: baseName, virtual_gift_id: null });
      if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase.from("user_watchlist").delete().eq("profile_id", profile.id).eq("kind", "gift_collection").eq("gift_collection", baseName);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ enabled });
}
