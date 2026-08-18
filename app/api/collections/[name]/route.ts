import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";

function displayName(row: { username?: unknown; first_name?: unknown } | undefined, label: string) {
  if (!row) throw new Error(`${label} profile is missing`);
  if (typeof row.username === "string" && row.username.length) return `@${row.username}`;
  if (typeof row.first_name === "string" && row.first_name.length) return row.first_name;
  throw new Error(`${label} profile name is missing`);
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
  };
}

function traitGroups(rows: Record<string, any>[], field: "model" | "backdrop" | "symbol") {
  const nameKey = `${field}_name`;
  const rarityKey = `${field}_rarity_per_mille`;
  const groups = new Map<string, { name: string; count: number; listedCount: number; floorPrice: number | null; rarityPerMille: number | null }>();
  for (const row of rows) {
    const name = String(row[nameKey]);
    const current = groups.get(name) || { name, count: 0, listedCount: 0, floorPrice: null, rarityPerMille: null };
    current.count += 1;
    const rarity = Number(row[rarityKey]);
    if (Number.isFinite(rarity)) current.rarityPerMille = rarity;
    if (row.status === "listed" && row.listing_price != null) {
      const listing = Number(row.listing_price);
      current.listedCount += 1;
      if (Number.isFinite(listing) && listing > 0) current.floorPrice = current.floorPrice == null ? listing : Math.min(current.floorPrice, listing);
    }
    groups.set(name, current);
  }
  return [...groups.values()].sort((a, b) => (a.rarityPerMille ?? Number.MAX_SAFE_INTEGER) - (b.rarityPerMille ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name } = await params;
  const baseName = decodeURIComponent(name).trim();
  if (!baseName) return NextResponse.json({ error: "Коллекция не указана" }, { status: 400 });
  const supabase = getSupabaseAdmin();

  try {
    const [collectionResult, giftRowsResult, listedResult, candlesResult, salesResult, watchedResult] = await Promise.all([
      supabase.from("gift_collection_overview").select("*").eq("base_name", baseName).maybeSingle(),
      supabase.from("gift_market_overview").select("model_name,model_rarity_per_mille,backdrop_name,backdrop_rarity_per_mille,symbol_name,symbol_rarity_per_mille,status,listing_price").eq("base_name", baseName).eq("is_burned", false).limit(1000),
      supabase.from("gift_market_overview").select("*").eq("base_name", baseName).eq("is_burned", false).eq("status", "listed").not("telegram_name", "is", null).not("model_file_id", "is", null).not("symbol_file_id", "is", null).order("listing_price", { ascending: true }).limit(240),
      supabase.from("gift_collection_candles").select("bucket_start,open,high,low,close,volume").eq("base_name", baseName).order("bucket_start", { ascending: true }).limit(4000),
      supabase.from("gift_trades").select("id,price,created_at,buyer_profile_id,seller_profile_id,gift_assets!inner(base_name,is_burned)").eq("gift_assets.base_name", baseName).eq("gift_assets.is_burned", false).order("created_at", { ascending: false }).limit(40),
      supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "gift_collection").eq("gift_collection", baseName).maybeSingle(),
    ]);

    const firstError = collectionResult.error || giftRowsResult.error || listedResult.error || candlesResult.error || salesResult.error || watchedResult.error;
    if (firstError) throw firstError;
    if (!collectionResult.data) return NextResponse.json({ error: "Коллекция не найдена" }, { status: 404 });

    const tradeRows = salesResult.data || [];
    const profileIds = [...new Set(tradeRows.flatMap((row) => [row.buyer_profile_id, row.seller_profile_id]).filter(Boolean).map(String))];
    const names = new Map<string, string>();
    if (profileIds.length) {
      const { data: people, error: peopleError } = await supabase.from("profiles").select("id,username,first_name").in("id", profileIds);
      if (peopleError) throw peopleError;
      for (const person of people || []) names.set(String(person.id), displayName(person, "Trade"));
    }

    const rows = (giftRowsResult.data || []) as Record<string, any>[];
    return NextResponse.json({
      collection: mapCollection(collectionResult.data),
      gifts: (listedResult.data || []).map(mapGift),
      candles: (candlesResult.data || []).map((candle) => ({
        time: Math.floor(new Date(candle.bucket_start).getTime() / 1000),
        open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume),
      })),
      models: traitGroups(rows, "model"),
      backdrops: traitGroups(rows, "backdrop"),
      symbols: traitGroups(rows, "symbol"),
      recentSales: tradeRows.map((trade) => ({
        id: String(trade.id),
        price: Number(trade.price),
        createdAt: String(trade.created_at),
        buyerId: String(trade.buyer_profile_id),
        buyerName: names.get(String(trade.buyer_profile_id)) || (() => { throw new Error("Buyer profile is missing from collection sales"); })(),
        sellerId: trade.seller_profile_id == null ? null : String(trade.seller_profile_id),
        sellerName: trade.seller_profile_id == null ? null : names.get(String(trade.seller_profile_id)) || (() => { throw new Error("Seller profile is missing from collection sales"); })(),
      })),
      watched: Boolean(watchedResult.data),
    });
  } catch (error) {
    console.error("gift collection detail", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить коллекцию" }, { status: 500 });
  }
}
