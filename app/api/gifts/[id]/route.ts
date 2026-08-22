import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getProfileSnapshot, requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";
import { resolveGiftAlias } from "@/lib/gifts/resolver";
import { finiteNumber, nonEmptyId, nullableNumber, safeIsoDate, text } from "@/lib/safe-data";

function personName(names: Map<string, string>, id: string) {
  return names.get(id) || "Пользователь";
}


async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  try {
    const giftRow = await resolveGiftAlias(id);
    if (!giftRow) return NextResponse.json({ error: "Gift not found" }, { status: 404 });

    const virtualGiftId = nonEmptyId(giftRow.virtual_gift_id);
    if (!virtualGiftId) return NextResponse.json({ error: "Gift record is invalid" }, { status: 422 });
    const baseName = text(giftRow.base_name, "Gift", 180);
    const nowIso = new Date().toISOString();

    const [tradesResult, offersResult, advancedOffersResult, collectionResult, itemStatsResult, listingEventsResult, cartResult, watchedResult, snapshot] = await Promise.all([
      supabase.from("gift_trades").select("id,price,created_at,buyer_profile_id,seller_profile_id").eq("virtual_gift_id", virtualGiftId).order("created_at", { ascending: false }).limit(40),
      supabase.from("gift_offers").select("id,buyer_profile_id,amount,status,created_at,expires_at").eq("virtual_gift_id", virtualGiftId).eq("status", "pending").order("amount", { ascending: false }).limit(30),
      supabase.from("advanced_gift_offers_v056").select("id,buyer_profile_id,base_name,scope_type,trait_value,amount,max_fills,filled_count,status,created_at,expires_at").eq("base_name", baseName).eq("status", "active").gt("expires_at", nowIso).order("amount", { ascending: false }).limit(50),
      supabase.from("gift_collection_overview").select("base_name,item_count,holder_count,listed_count,floor_price,last_sale_price,volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct,all_time_volume,total_sales,high_sale,external_floor").eq("base_name", baseName).maybeSingle(),
      supabase.rpc("gift_item_market_stats", { p_virtual_gift_id: virtualGiftId }).single(),
      supabase.from("gift_listing_events").select("id,actor_profile_id,kind,price,previous_price,created_at").eq("virtual_gift_id", virtualGiftId).order("created_at", { ascending: false }).limit(60),
      supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id).eq("virtual_gift_id", virtualGiftId).maybeSingle(),
      supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "gift").eq("virtual_gift_id", virtualGiftId).maybeSingle(),
      getProfileSnapshot(profile),
    ]);

    const firstDetailError = tradesResult.error || offersResult.error || advancedOffersResult.error || collectionResult.error
      || itemStatsResult.error || listingEventsResult.error || cartResult.error || watchedResult.error;
    if (firstDetailError) throw firstDetailError;

    const trades = tradesResult.data || [];
    const offers = (offersResult.data || []).filter((offer) => !offer.expires_at || String(offer.expires_at) > nowIso);
    const advancedOffers = (advancedOffersResult.data || []).filter((offer) => {
      if (String(offer.buyer_profile_id) === String(profile.id)) return false;
      const scope = String(offer.scope_type);
      if (scope === "collection") return true;
      if (scope === "model") return String(offer.trait_value || "") === String(giftRow.model_name || "");
      if (scope === "backdrop") return String(offer.trait_value || "") === String(giftRow.backdrop_name || "");
      if (scope === "symbol") return String(offer.trait_value || "") === String(giftRow.symbol_name || "");
      return false;
    });
    const listingEvents = listingEventsResult.data || [];

    const profileIds = new Set<string>();
    for (const trade of trades) {
      if (trade.buyer_profile_id) profileIds.add(String(trade.buyer_profile_id));
      if (trade.seller_profile_id) profileIds.add(String(trade.seller_profile_id));
    }
    for (const offer of offers) if (offer.buyer_profile_id) profileIds.add(String(offer.buyer_profile_id));
    for (const offer of advancedOffers) if (offer.buyer_profile_id) profileIds.add(String(offer.buyer_profile_id));
    for (const event of listingEvents) if (event.actor_profile_id) profileIds.add(String(event.actor_profile_id));

    const peopleResult = profileIds.size
      ? await supabase.from("profiles").select("id,username,first_name").in("id", [...profileIds])
      : { data: [] as Array<{ id: string; username: string | null; first_name: string | null }>, error: null };
    if (peopleResult.error) throw peopleResult.error;
    const names = new Map<string, string>((peopleResult.data || []).map((person) => [
      String(person.id), person.username ? `@${person.username}` : person.first_name || "Пользователь",
    ]));

    const collection = collectionResult.data as unknown as Record<string, unknown> | null;
    const itemStats = itemStatsResult.data as unknown as Record<string, unknown> | null;
    const gift = mapGift(giftRow);

    const collectionFloor = nullableNumber(collection?.floor_price) ?? gift.collectionFloor;
    const collectionLastSale = nullableNumber(collection?.last_sale_price);

    const saleActivity = trades.flatMap((trade) => {
      const tradeId = nonEmptyId(trade.id);
      if (!tradeId) return [];
      const actorId = nonEmptyId(trade.buyer_profile_id);
      return [{
        id: `sale:${tradeId}`,
        kind: "sale" as const,
        price: finiteNumber(trade.price),
        previousPrice: null,
        actorId,
        actorName: actorId ? personName(names, actorId) : null,
        createdAt: safeIsoDate(trade.created_at),
      }];
    });
    const listingActivity = listingEvents
      .filter((event) => event.kind !== "sold" && event.kind !== "offer_accepted")
      .flatMap((event) => {
        const eventId = nonEmptyId(event.id);
        if (!eventId) return [];
        const actorId = nonEmptyId(event.actor_profile_id);
        const kind = text(event.kind, "", 32);
        if (!(["listed", "repriced", "unlisted", "expired"] as string[]).includes(kind)) return [];
        return [{
          id: `listing:${eventId}`,
          kind: kind as "listed" | "repriced" | "unlisted" | "expired",
          price: nullableNumber(event.price),
          previousPrice: nullableNumber(event.previous_price),
          actorId,
          actorName: actorId ? personName(names, actorId) : null,
          createdAt: safeIsoDate(event.created_at),
        }];
      });
    const activity = [...saleActivity, ...listingActivity]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 60);

    return NextResponse.json({
      gift,
      resolvedVirtualGiftId: virtualGiftId,
      isOwner: gift.ownerId === String(profile.id),
      inCart: Boolean(cartResult.data),
      watched: Boolean(watchedResult.data),
      balance: snapshot.balance,
      availableBalance: snapshot.availableBalance,
      reservedBalance: snapshot.reservedBalance,
      trades: trades.flatMap((trade) => {
        const tradeId = nonEmptyId(trade.id);
        const buyerId = nonEmptyId(trade.buyer_profile_id);
        if (!tradeId || !buyerId) return [];
        const sellerId = nonEmptyId(trade.seller_profile_id);
        return [{ id: tradeId, price: finiteNumber(trade.price), createdAt: safeIsoDate(trade.created_at), buyerId, buyerName: personName(names, buyerId), sellerId, sellerName: sellerId ? personName(names, sellerId) : null }];
      }),
      activity,
      candles: [],
      itemStats: {
        tradeCount: finiteNumber(itemStats?.trade_count),
        volume: finiteNumber(itemStats?.volume),
        highSale: nullableNumber(itemStats?.high_sale),
        lowSale: nullableNumber(itemStats?.low_sale),
      },
      collection: {
        baseName,
        itemCount: finiteNumber(collection?.item_count), holderCount: finiteNumber(collection?.holder_count), listedCount: finiteNumber(collection?.listed_count),
        floorPrice: collectionFloor, lastSalePrice: collectionLastSale, volume24h: finiteNumber(collection?.volume_24h), change24h: finiteNumber(collection?.change_24h), tradeCount24h: finiteNumber(collection?.trade_count_24h),
        volume7d: finiteNumber(collection?.volume_7d), tradeCount7d: finiteNumber(collection?.trade_count_7d), listedPct: finiteNumber(collection?.listed_pct),
        allTimeVolume: finiteNumber(collection?.all_time_volume), totalSales: finiteNumber(collection?.total_sales), highSale: nullableNumber(collection?.high_sale), externalFloor: nullableNumber(collection?.external_floor),
      },
      traitStats: {
        collectionFloor,
        modelFloor: gift.modelFloor,
        backdropFloor: gift.backdropFloor,
        symbolFloor: gift.symbolFloor,
        collectionLastSale,
        externalListingPrice: gift.externalListingPrice,
        referencePrice: gift.referencePrice,
        priceBasis: gift.priceBasis,
      },
      offers: offers.flatMap((offer) => {
        const offerId = nonEmptyId(offer.id);
        const buyerId = nonEmptyId(offer.buyer_profile_id);
        if (!offerId || !buyerId) return [];
        return [{ id: offerId, amount: finiteNumber(offer.amount), status: text(offer.status, "pending", 32), createdAt: safeIsoDate(offer.created_at), expiresAt: offer.expires_at ? safeIsoDate(offer.expires_at) : null, buyerId, buyerName: personName(names, buyerId), isMine: buyerId === String(profile.id) }];
      }),
      advancedOffers: advancedOffers.flatMap((offer) => {
        const offerId = nonEmptyId(offer.id);
        const buyerId = nonEmptyId(offer.buyer_profile_id);
        if (!offerId || !buyerId) return [];
        return [{ id: offerId, buyerId, buyerName: personName(names, buyerId), scopeType: text(offer.scope_type, "collection", 32), traitValue: offer.trait_value == null ? null : text(offer.trait_value, "", 160) || null, amount: finiteNumber(offer.amount), maxFills: finiteNumber(offer.max_fills), filledCount: finiteNumber(offer.filled_count), expiresAt: safeIsoDate(offer.expires_at), createdAt: safeIsoDate(offer.created_at) }];
      }),
    }, { headers: { "cache-control": "private, max-age=0, must-revalidate", "server-timing": `gift-detail;dur=${(performance.now() - startedAt).toFixed(1)}` } });
  } catch (error) {
    console.error("gift detail", error);
    return apiFailure(error, "Не удалось загрузить Gift");
  }
}
export const GET = withApiErrors("app/api/gifts/[id]/route.ts:GET", GETHandler);
