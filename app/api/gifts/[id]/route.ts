import { NextResponse } from "next/server";
import { getProfileSnapshot, requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const legacyGiftMarketSelect = giftMarketSelect.split(",").filter((column) => column !== "model_preview_url").join(",");

type GiftMarketRow = Record<string, unknown> & {
  asset_id: string;
  virtual_gift_id: string;
  telegram_name: string;
  base_name: string;
  model_name: string;
  backdrop_name: string;
  symbol_name: string;
  model_preview_url: string | null;
};

function personName(names: Map<string, string>, id: string) {
  return names.get(id) || "Пользователь";
}

function isLegacyPreviewColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42703" || /model_preview_url/i.test(error.message || "");
}

async function lookupGiftRow(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  column: "virtual_gift_id" | "asset_id" | "telegram_name",
  value: string,
) {
  const run = (select: string) => supabase
    .from("gift_market_overview")
    .select(select)
    .eq(column, value)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const primary = await run(giftMarketSelect);
  let error = primary.error;
  let data = primary.data as unknown as Record<string, unknown> | null;

  // v0.15 introduced model_preview_url. Older deployments could still render
  // the market because the RPC returns the view wholesale, while this explicit
  // select failed and was incorrectly translated into a 404. Retry against the
  // v0.14-compatible column set so the detail page can still resolve the Gift.
  if (error && isLegacyPreviewColumnError(error)) {
    const legacy = await run(legacyGiftMarketSelect);
    error = legacy.error;
    data = legacy.data as unknown as Record<string, unknown> | null;
  }

  if (error) throw error;
  if (!data) return null;
  return { model_preview_url: null, ...data } as GiftMarketRow;
}

async function resolveGiftRow(supabase: ReturnType<typeof getSupabaseAdmin>, routeId: string) {
  let decoded = routeId;
  try { decoded = decodeURIComponent(routeId); } catch { /* Next usually decodes params already. */ }
  const id = decoded.trim();
  if (!id || id.length > 220) return null;

  // Market cards use virtual_gift_id, but accepting asset_id and telegram_name
  // as aliases makes old/shared links survive catalog re-imports and route changes.
  if (UUID_RE.test(id)) {
    const byVirtual = await lookupGiftRow(supabase, "virtual_gift_id", id);
    if (byVirtual) return byVirtual;
    const byAsset = await lookupGiftRow(supabase, "asset_id", id);
    if (byAsset) return byAsset;
  }

  return lookupGiftRow(supabase, "telegram_name", id);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  try {
    const giftRow = await resolveGiftRow(supabase, id);
    if (!giftRow) return NextResponse.json({ error: "Gift not found" }, { status: 404 });

    const virtualGiftId = String(giftRow.virtual_gift_id);
    const baseName = String(giftRow.base_name);

    const [tradesResult, candlesResult, offersResult, collectionResult, modelFloorResult, backdropFloorResult, symbolFloorResult, itemStatsResult, snapshot] = await Promise.all([
      supabase.from("gift_trades").select("id,price,created_at,buyer_profile_id,seller_profile_id").eq("virtual_gift_id", virtualGiftId).order("created_at", { ascending: false }).limit(80),
      supabase.from("gift_collection_candles").select("bucket_start,open,high,low,close,volume").eq("base_name", baseName).order("bucket_start", { ascending: false }).limit(1200),
      supabase.from("gift_offers").select("id,buyer_profile_id,amount,status,created_at").eq("virtual_gift_id", virtualGiftId).eq("status", "pending").order("amount", { ascending: false }).limit(60),
      supabase.from("gift_collection_overview").select("*").eq("base_name", baseName).maybeSingle(),
      supabase.from("gift_market_overview").select("listing_price").eq("base_name", baseName).eq("model_name", giftRow.model_name).eq("status", "listed").eq("is_burned", false).order("listing_price", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("gift_market_overview").select("listing_price").eq("base_name", baseName).eq("backdrop_name", giftRow.backdrop_name).eq("status", "listed").eq("is_burned", false).order("listing_price", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("gift_market_overview").select("listing_price").eq("base_name", baseName).eq("symbol_name", giftRow.symbol_name).eq("status", "listed").eq("is_burned", false).order("listing_price", { ascending: true }).limit(1).maybeSingle(),
      supabase.rpc("gift_item_market_stats", { p_virtual_gift_id: virtualGiftId }).single(),
      getProfileSnapshot(profile),
    ]);

    // Detail analytics are secondary. A stale candle/stat helper should not make
    // the NFT itself disappear; only the core overview row is required.
    for (const [label, result] of [
      ["trades", tradesResult],
      ["candles", candlesResult],
      ["offers", offersResult],
      ["collection", collectionResult],
      ["model floor", modelFloorResult],
      ["backdrop floor", backdropFloorResult],
      ["symbol floor", symbolFloorResult],
      ["item stats", itemStatsResult],
    ] as const) {
      if (result.error) console.warn(`gift detail ${label}`, result.error);
    }

    const trades = tradesResult.error ? [] : tradesResult.data || [];
    const offers = offersResult.error ? [] : offersResult.data || [];
    const candles = candlesResult.error ? [] : candlesResult.data || [];

    const profileIds = new Set<string>();
    for (const trade of trades) {
      if (trade.buyer_profile_id) profileIds.add(String(trade.buyer_profile_id));
      if (trade.seller_profile_id) profileIds.add(String(trade.seller_profile_id));
    }
    for (const offer of offers) if (offer.buyer_profile_id) profileIds.add(String(offer.buyer_profile_id));

    const peopleResult = profileIds.size
      ? await supabase.from("profiles").select("id,username,first_name").in("id", [...profileIds])
      : { data: [] as any[], error: null };
    if (peopleResult.error) console.warn("gift detail people", peopleResult.error);
    const names = new Map<string, string>((peopleResult.data || []).map((person: any) => {
      const name = person.username ? `@${person.username}` : person.first_name || "Пользователь";
      return [String(person.id), String(name)] as [string, string];
    }));

    const cartResult = await supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id).eq("virtual_gift_id", virtualGiftId).maybeSingle();
    if (cartResult.error) console.warn("gift detail cart", cartResult.error);

    const collection = collectionResult.error ? null : collectionResult.data as unknown as Record<string, any> | null;
    const itemStats = itemStatsResult.error ? null : itemStatsResult.data as unknown as {
      trade_count?: number | string | null;
      volume?: number | string | null;
      high_sale?: number | string | null;
      low_sale?: number | string | null;
    } | null;
    const gift = mapGift(giftRow);

    const collectionFloor = collection?.floor_price == null ? null : Number(collection.floor_price);
    const collectionLastSale = collection?.last_sale_price == null ? null : Number(collection.last_sale_price);

    return NextResponse.json({
      gift,
      resolvedVirtualGiftId: virtualGiftId,
      isOwner: gift.ownerId === String(profile.id),
      inCart: Boolean(cartResult.data),
      balance: snapshot.balance,
      availableBalance: snapshot.availableBalance,
      reservedBalance: snapshot.reservedBalance,
      trades: trades.map((trade: any) => ({
        id: String(trade.id), price: Number(trade.price), createdAt: String(trade.created_at), buyerId: String(trade.buyer_profile_id), buyerName: personName(names, String(trade.buyer_profile_id)),
        sellerId: trade.seller_profile_id ? String(trade.seller_profile_id) : null,
        sellerName: trade.seller_profile_id ? personName(names, String(trade.seller_profile_id)) : null,
      })),
      candles: [...candles].reverse().map((candle: any) => ({
        time: Math.floor(new Date(candle.bucket_start).getTime() / 1000), open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume),
      })),
      itemStats: {
        tradeCount: Number(itemStats?.trade_count || 0),
        volume: Number(itemStats?.volume || 0),
        highSale: itemStats?.high_sale == null ? null : Number(itemStats.high_sale),
        lowSale: itemStats?.low_sale == null ? null : Number(itemStats.low_sale),
      },
      collection: {
        baseName,
        itemCount: Number(collection?.item_count || 0),
        holderCount: Number(collection?.holder_count || 0),
        listedCount: Number(collection?.listed_count || 0),
        floorPrice: collectionFloor,
        lastSalePrice: collectionLastSale,
        volume24h: Number(collection?.volume_24h || 0),
        change24h: Number(collection?.change_24h || 0),
        tradeCount24h: Number(collection?.trade_count_24h || 0),
      },
      traitStats: {
        collectionFloor,
        modelFloor: modelFloorResult.error || modelFloorResult.data?.listing_price == null ? null : Number(modelFloorResult.data.listing_price),
        backdropFloor: backdropFloorResult.error || backdropFloorResult.data?.listing_price == null ? null : Number(backdropFloorResult.data.listing_price),
        symbolFloor: symbolFloorResult.error || symbolFloorResult.data?.listing_price == null ? null : Number(symbolFloorResult.data.listing_price),
        collectionLastSale,
        estimatedValue: gift.estimatedValue,
      },
      offers: offers.map((offer: any) => ({
        id: String(offer.id), amount: Number(offer.amount), status: offer.status, createdAt: String(offer.created_at), buyerId: String(offer.buyer_profile_id), buyerName: personName(names, String(offer.buyer_profile_id)), isMine: String(offer.buyer_profile_id) === String(profile.id),
      })),
    }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("gift detail", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Gift" }, { status: 500 });
  }
}
