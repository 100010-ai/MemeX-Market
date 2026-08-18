import { NextResponse } from "next/server";
import { getProfileSnapshot, requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";

function personName(names: Map<string, string>, id: string) {
  const name = names.get(id);
  if (!name) throw new Error(`Profile ${id} is missing from Gift activity`);
  return name;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  try {
    const { data: giftRow, error } = await supabase.from("gift_market_overview").select("*").eq("virtual_gift_id", id).not("telegram_name", "is", null).not("model_file_id", "is", null).not("symbol_file_id", "is", null).single();
    if (error || !giftRow) return NextResponse.json({ error: "Gift not found" }, { status: 404 });

    const [tradesResult, candlesResult, offersResult, collectionResult, modelFloorResult, backdropFloorResult, symbolFloorResult, snapshot] = await Promise.all([
      supabase.from("gift_trades").select("id,price,created_at,buyer_profile_id,seller_profile_id").eq("virtual_gift_id", id).order("created_at", { ascending: false }).limit(80),
      supabase.from("gift_collection_candles").select("bucket_start,open,high,low,close,volume").eq("base_name", giftRow.base_name).order("bucket_start", { ascending: true }).limit(4000),
      supabase.from("gift_offers").select("id,buyer_profile_id,amount,status,created_at").eq("virtual_gift_id", id).eq("status", "pending").order("amount", { ascending: false }).limit(60),
      supabase.from("gift_collection_overview").select("*").eq("base_name", giftRow.base_name).single(),
      supabase.from("gift_market_overview").select("listing_price").eq("base_name", giftRow.base_name).eq("model_name", giftRow.model_name).eq("status", "listed").eq("is_burned", false).order("listing_price", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("gift_market_overview").select("listing_price").eq("base_name", giftRow.base_name).eq("backdrop_name", giftRow.backdrop_name).eq("status", "listed").eq("is_burned", false).order("listing_price", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("gift_market_overview").select("listing_price").eq("base_name", giftRow.base_name).eq("symbol_name", giftRow.symbol_name).eq("status", "listed").eq("is_burned", false).order("listing_price", { ascending: true }).limit(1).maybeSingle(),
      getProfileSnapshot(profile),
    ]);
    const firstError = tradesResult.error || candlesResult.error || offersResult.error || collectionResult.error || modelFloorResult.error || backdropFloorResult.error || symbolFloorResult.error;
    if (firstError) throw firstError;

    const profileIds = new Set<string>();
    for (const trade of tradesResult.data || []) {
      if (trade.buyer_profile_id) profileIds.add(String(trade.buyer_profile_id));
      if (trade.seller_profile_id) profileIds.add(String(trade.seller_profile_id));
    }
    for (const offer of offersResult.data || []) if (offer.buyer_profile_id) profileIds.add(String(offer.buyer_profile_id));
    const peopleResult = profileIds.size
      ? await supabase.from("profiles").select("id,username,first_name").in("id", [...profileIds])
      : { data: [] as any[], error: null };
    if (peopleResult.error) throw peopleResult.error;
    const names = new Map<string, string>((peopleResult.data || []).map((person: any) => {
      const name = person.username ? `@${person.username}` : person.first_name;
      if (typeof name !== "string" || !name) throw new Error(`Profile ${person.id} has no display name`);
      return [String(person.id), name] as [string, string];
    }));

    const collection = collectionResult.data;
    if (!collection) throw new Error("Gift collection market row is missing");
    const gift = mapGift(giftRow);
    return NextResponse.json({
      gift,
      isOwner: gift.ownerId === String(profile.id),
      balance: snapshot.balance,
      availableBalance: snapshot.availableBalance,
      reservedBalance: snapshot.reservedBalance,
      trades: (tradesResult.data || []).map((trade: any) => ({
        id: String(trade.id), price: Number(trade.price), createdAt: String(trade.created_at), buyerId: String(trade.buyer_profile_id), buyerName: personName(names, String(trade.buyer_profile_id)),
        sellerId: trade.seller_profile_id ? String(trade.seller_profile_id) : null,
        sellerName: trade.seller_profile_id ? personName(names, String(trade.seller_profile_id)) : null,
      })),
      candles: (candlesResult.data || []).map((candle: any) => ({
        time: Math.floor(new Date(candle.bucket_start).getTime() / 1000), open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume),
      })),
      collection: {
        baseName: String(giftRow.base_name), itemCount: Number(collection.item_count), holderCount: Number(collection.holder_count), listedCount: Number(collection.listed_count),
        floorPrice: collection.floor_price == null ? null : Number(collection.floor_price),
        lastSalePrice: collection.last_sale_price == null ? null : Number(collection.last_sale_price),
        volume24h: Number(collection.volume_24h), change24h: Number(collection.change_24h), tradeCount24h: Number(collection.trade_count_24h),
      },
      traitStats: {
        collectionFloor: collection.floor_price == null ? null : Number(collection.floor_price),
        modelFloor: modelFloorResult.data?.listing_price == null ? null : Number(modelFloorResult.data.listing_price),
        backdropFloor: backdropFloorResult.data?.listing_price == null ? null : Number(backdropFloorResult.data.listing_price),
        symbolFloor: symbolFloorResult.data?.listing_price == null ? null : Number(symbolFloorResult.data.listing_price),
        collectionLastSale: collection.last_sale_price == null ? null : Number(collection.last_sale_price),
        estimatedValue: gift.estimatedValue,
      },
      offers: (offersResult.data || []).map((offer: any) => ({
        id: String(offer.id), amount: Number(offer.amount), status: offer.status, createdAt: String(offer.created_at), buyerId: String(offer.buyer_profile_id), buyerName: personName(names, String(offer.buyer_profile_id)), isMine: String(offer.buyer_profile_id) === String(profile.id),
      })),
    });
  } catch (error) {
    console.error("gift detail", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Gift" }, { status: 500 });
  }
}
