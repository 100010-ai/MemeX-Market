import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { mapGift, mapGiftCollection } from "@/lib/mappers";
import { finiteNumber, nonEmptyId, nullableNumber, safeDecodeURIComponent, safeIsoDate, safeUnixSeconds, text } from "@/lib/safe-data";

const INITIAL_LISTING_LIMIT = 36;

function displayName(row: { username?: unknown; first_name?: unknown } | undefined) {
  const username = text(row?.username, "", 64);
  if (username) return `@${username}`;
  return text(row?.first_name, "Пользователь", 120);
}

function mapTraitStats(rows: Record<string, unknown>[], type: "model" | "backdrop" | "symbol") {
  return rows.flatMap((row) => {
    if (row.trait_type !== type) return [];
    const name = text(row.name, "", 160);
    if (!name) return [];
    return [{
      name,
      count: finiteNumber(row.item_count),
      listedCount: finiteNumber(row.listed_count),
      floorPrice: nullableNumber(row.floor_price),
      rarityPerMille: nullableNumber(row.rarity_per_mille),
    }];
  });
}

type GiftPage = { gifts?: unknown; nextOffset?: unknown };
function parseGiftPage(value: unknown) {
  const page = value && typeof value === "object" && !Array.isArray(value) ? value as GiftPage : {};
  const gifts = Array.isArray(page.gifts) ? page.gifts : [];
  const nextRaw = page.nextOffset == null ? null : Number(page.nextOffset);
  return { gifts, nextOffset: nextRaw != null && Number.isInteger(nextRaw) && nextRaw >= 0 ? nextRaw : null };
}

async function GETHandler(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const startedAt = performance.now();
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const { name } = await params;
  const baseName = safeDecodeURIComponent(name);
  if (!baseName) return NextResponse.json({ error: "Некорректное имя коллекции" }, { status: 400 });
  const supabase = getSupabaseAdmin();

  try {
    const [collectionResult, traitStatsResult, listedResult, candlesResult, salesResult, activityResult, watchedResult] = await Promise.all([
      supabase.from("gift_collection_overview").select("base_name,item_count,holder_count,listed_count,floor_price,last_sale_price,volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct,all_time_volume,total_sales,high_sale,external_floor").eq("base_name", baseName).maybeSingle(),
      supabase.rpc("gift_collection_trait_stats", { p_base_name: baseName }),
      supabase.rpc("gift_market_filtered_page_v200", {
        p_seed: `collection:${baseName}`, p_offset: 0, p_limit: INITIAL_LISTING_LIMIT, p_collection: baseName,
        p_model: null, p_backdrop: null, p_symbol: null, p_price_band: "all", p_view: "all", p_sort: "price",
      }),
      supabase.from("gift_collection_candles").select("bucket_start,open,high,low,close,volume").eq("base_name", baseName).order("bucket_start", { ascending: false }).limit(480),
      supabase.from("gift_trades").select("id,price,created_at,buyer_profile_id,seller_profile_id,gift_assets!inner(base_name,is_burned)").eq("gift_assets.base_name", baseName).eq("gift_assets.is_burned", false).order("created_at", { ascending: false }).limit(24),
      supabase.from("gift_listing_events").select("id,virtual_gift_id,actor_profile_id,kind,price,previous_price,created_at,gift_assets!inner(base_name,gift_number,is_burned)").eq("gift_assets.base_name", baseName).eq("gift_assets.is_burned", false).order("created_at", { ascending: false }).limit(50),
      supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "gift_collection").eq("gift_collection", baseName).maybeSingle(),
    ]);

    const firstError = collectionResult.error || traitStatsResult.error || listedResult.error || candlesResult.error || salesResult.error || activityResult.error || watchedResult.error;
    if (firstError) throw firstError;
    if (!collectionResult.data) return NextResponse.json({ error: "Коллекция не найдена" }, { status: 404 });

    const tradeRows = salesResult.data || [];
    const activityRows = activityResult.data || [];
    const profileIds = [...new Set([...tradeRows.flatMap((row) => [row.buyer_profile_id, row.seller_profile_id]), ...activityRows.map((row) => row.actor_profile_id)].filter(Boolean).map(String))];
    const names = new Map<string, string>();
    if (profileIds.length) {
      const { data: people, error: peopleError } = await supabase.from("profiles").select("id,username,first_name").in("id", profileIds);
      if (peopleError) throw peopleError;
      for (const person of people || []) names.set(String(person.id), displayName(person));
    }

    const traitRows = (traitStatsResult.data || []) as Record<string, unknown>[];
    const listedPage = parseGiftPage(listedResult.data);
    return NextResponse.json({
      collection: mapGiftCollection(collectionResult.data as Record<string, unknown>),
      gifts: listedPage.gifts.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? [mapGift(row as Record<string, unknown>)] : []).filter((gift) => Boolean(gift.virtualGiftId)),
      nextOffset: listedPage.nextOffset,
      candles: [...(candlesResult.data || [])].reverse().flatMap((candle) => {
        const time = safeUnixSeconds(candle.bucket_start);
        if (time == null) return [];
        return [{ time, open: finiteNumber(candle.open), high: finiteNumber(candle.high), low: finiteNumber(candle.low), close: finiteNumber(candle.close), volume: finiteNumber(candle.volume) }];
      }),
      models: mapTraitStats(traitRows, "model"),
      backdrops: mapTraitStats(traitRows, "backdrop"),
      symbols: mapTraitStats(traitRows, "symbol"),
      activity: activityRows.flatMap((event) => {
        const eventId = nonEmptyId(event.id);
        const virtualGiftId = nonEmptyId(event.virtual_gift_id);
        if (!eventId || !virtualGiftId) return [];
        const asset = Array.isArray(event.gift_assets) ? event.gift_assets[0] : event.gift_assets;
        const actorId = nonEmptyId(event.actor_profile_id);
        return [{
          id: eventId,
          virtualGiftId,
          giftNumber: finiteNumber(asset?.gift_number),
          kind: text(event.kind, "listed", 40),
          price: nullableNumber(event.price),
          previousPrice: nullableNumber(event.previous_price),
          actorId,
          actorName: actorId ? names.get(actorId) || "Пользователь" : null,
          createdAt: safeIsoDate(event.created_at),
        }];
      }),
      recentSales: tradeRows.flatMap((trade) => {
        const tradeId = nonEmptyId(trade.id);
        const buyerId = nonEmptyId(trade.buyer_profile_id);
        if (!tradeId || !buyerId) return [];
        const sellerId = nonEmptyId(trade.seller_profile_id);
        return [{
          id: tradeId,
          price: finiteNumber(trade.price),
          createdAt: safeIsoDate(trade.created_at),
          buyerId,
          buyerName: names.get(buyerId) || "Пользователь",
          sellerId,
          sellerName: sellerId ? names.get(sellerId) || "Пользователь" : null,
        }];
      }),
      watched: Boolean(watchedResult.data),
    }, { headers: { "server-timing": `collection;dur=${(performance.now() - startedAt).toFixed(1)}`, "cache-control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("gift collection detail", error);
    return apiFailure(error, "Не удалось загрузить коллекцию");
  }
}
export const GET = withApiErrors("app/api/collections/[name]/route.ts:GET", GETHandler);
