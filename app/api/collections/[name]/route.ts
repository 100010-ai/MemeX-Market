import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";

const INITIAL_LISTING_LIMIT = 36;

function displayName(row: { username?: unknown; first_name?: unknown } | undefined) {
  if (row && typeof row.username === "string" && row.username.length) return `@${row.username}`;
  if (row && typeof row.first_name === "string" && row.first_name.length) return row.first_name;
  return "Пользователь";
}

function mapCollection(row: Record<string, unknown>) {
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

function mapTraitStats(rows: Record<string, unknown>[], type: "model" | "backdrop" | "symbol") {
  return rows
    .filter((row) => row.trait_type === type)
    .map((row) => ({
      name: String(row.name),
      count: Number(row.item_count || 0),
      listedCount: Number(row.listed_count || 0),
      floorPrice: row.floor_price == null ? null : Number(row.floor_price),
      rarityPerMille: row.rarity_per_mille == null ? null : Number(row.rarity_per_mille),
    }));
}


export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const startedAt = performance.now();
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name } = await params;
  const baseName = decodeURIComponent(name).trim();
  if (!baseName) return NextResponse.json({ error: "Коллекция не указана" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  try {
    const [collectionResult, traitStatsResult, listedResult, candlesResult, salesResult, activityResult, watchedResult] = await Promise.all([
      supabase.from("gift_collection_overview").select("base_name,item_count,holder_count,listed_count,floor_price,last_sale_price,volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct,all_time_volume,total_sales,high_sale,external_floor").eq("base_name", baseName).maybeSingle(),
      supabase.rpc("gift_collection_trait_stats", { p_base_name: baseName }),
      supabase.from("gift_market_overview").select(giftMarketSelect, { count: "exact" }).eq("base_name", baseName).eq("is_burned", false).eq("status", "listed").or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`).not("telegram_name", "is", null).order("listing_price", { ascending: true }).range(0, INITIAL_LISTING_LIMIT - 1),
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
    return NextResponse.json({
      collection: mapCollection(collectionResult.data),
      gifts: (listedResult.data || []).map(mapGift),
      nextOffset: (listedResult.data || []).length < (listedResult.count || 0) ? (listedResult.data || []).length : null,
      candles: [...(candlesResult.data || [])].reverse().map((candle) => ({
        time: Math.floor(new Date(candle.bucket_start).getTime() / 1000),
        open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume),
      })),
      models: mapTraitStats(traitRows, "model"),
      backdrops: mapTraitStats(traitRows, "backdrop"),
      symbols: mapTraitStats(traitRows, "symbol"),
      activity: activityRows.map((event) => {
        const asset = Array.isArray(event.gift_assets) ? event.gift_assets[0] : event.gift_assets;
        return {
          id: String(event.id),
          virtualGiftId: String(event.virtual_gift_id),
          giftNumber: Number(asset?.gift_number || 0),
          kind: event.kind,
          price: event.price == null ? null : Number(event.price),
          previousPrice: event.previous_price == null ? null : Number(event.previous_price),
          actorId: event.actor_profile_id ? String(event.actor_profile_id) : null,
          actorName: event.actor_profile_id ? names.get(String(event.actor_profile_id)) || "Пользователь" : null,
          createdAt: String(event.created_at),
        };
      }),
      recentSales: tradeRows.map((trade) => ({
        id: String(trade.id),
        price: Number(trade.price),
        createdAt: String(trade.created_at),
        buyerId: String(trade.buyer_profile_id),
        buyerName: names.get(String(trade.buyer_profile_id)) || "Пользователь",
        sellerId: trade.seller_profile_id == null ? null : String(trade.seller_profile_id),
        sellerName: trade.seller_profile_id == null ? null : names.get(String(trade.seller_profile_id)) || "Пользователь",
      })),
      watched: Boolean(watchedResult.data),
    }, { headers: { "server-timing": `collection;dur=${(performance.now() - startedAt).toFixed(1)}`, "cache-control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("gift collection detail", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить коллекцию" }, { status: 500 });
  }
}
