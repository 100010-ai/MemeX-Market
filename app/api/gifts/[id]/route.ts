import { NextResponse } from "next/server";
import { getProfileSnapshot, requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";
import { resolveGiftAlias } from "@/lib/gifts/resolver";

function personName(names: Map<string, string>, id: string) {
  return names.get(id) || "Пользователь";
}

function numberOrNull(value: unknown) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  try {
    const giftRow = await resolveGiftAlias(id);
    if (!giftRow) return NextResponse.json({ error: "Gift not found" }, { status: 404 });

    const virtualGiftId = String(giftRow.virtual_gift_id);
    const baseName = String(giftRow.base_name);
    const nowIso = new Date().toISOString();

    const [tradesResult, offersResult, collectionResult, itemStatsResult, listingEventsResult, cartResult, watchedResult, snapshot] = await Promise.all([
      supabase.from("gift_trades").select("id,price,created_at,buyer_profile_id,seller_profile_id").eq("virtual_gift_id", virtualGiftId).order("created_at", { ascending: false }).limit(40),
      supabase.from("gift_offers").select("id,buyer_profile_id,amount,status,created_at,expires_at").eq("virtual_gift_id", virtualGiftId).eq("status", "pending").order("amount", { ascending: false }).limit(30),
      supabase.from("gift_collection_overview").select("base_name,item_count,holder_count,listed_count,floor_price,last_sale_price,volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct,all_time_volume,total_sales,high_sale,external_floor").eq("base_name", baseName).maybeSingle(),
      supabase.rpc("gift_item_market_stats", { p_virtual_gift_id: virtualGiftId }).single(),
      supabase.from("gift_listing_events").select("id,actor_profile_id,kind,price,previous_price,created_at").eq("virtual_gift_id", virtualGiftId).order("created_at", { ascending: false }).limit(60),
      supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id).eq("virtual_gift_id", virtualGiftId).maybeSingle(),
      supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "gift").eq("virtual_gift_id", virtualGiftId).maybeSingle(),
      getProfileSnapshot(profile),
    ]);

    // Analytics/history are secondary. The core resolved Gift stays usable when
    // an optional v0.30 table is not migrated during a rolling deployment.
    for (const [label, result] of [
      ["trades", tradesResult], ["offers", offersResult],
      ["collection", collectionResult], ["item stats", itemStatsResult], ["listing events", listingEventsResult], ["cart", cartResult], ["watchlist", watchedResult],
    ] as const) {
      if (result.error) console.warn(`gift detail ${label}`, result.error);
    }

    const trades = tradesResult.error ? [] : tradesResult.data || [];
    const offers = offersResult.error ? [] : (offersResult.data || []).filter((offer) => !offer.expires_at || String(offer.expires_at) > nowIso);
    const listingEvents = listingEventsResult.error ? [] : listingEventsResult.data || [];

    const profileIds = new Set<string>();
    for (const trade of trades) {
      if (trade.buyer_profile_id) profileIds.add(String(trade.buyer_profile_id));
      if (trade.seller_profile_id) profileIds.add(String(trade.seller_profile_id));
    }
    for (const offer of offers) if (offer.buyer_profile_id) profileIds.add(String(offer.buyer_profile_id));
    for (const event of listingEvents) if (event.actor_profile_id) profileIds.add(String(event.actor_profile_id));

    const peopleResult = profileIds.size
      ? await supabase.from("profiles").select("id,username,first_name").in("id", [...profileIds])
      : { data: [] as Array<{ id: string; username: string | null; first_name: string | null }>, error: null };
    if (peopleResult.error) console.warn("gift detail people", peopleResult.error);
    const names = new Map<string, string>((peopleResult.data || []).map((person) => [
      String(person.id), person.username ? `@${person.username}` : person.first_name || "Пользователь",
    ]));

    const collection = collectionResult.error ? null : collectionResult.data as unknown as Record<string, unknown> | null;
    const itemStats = itemStatsResult.error ? null : itemStatsResult.data as unknown as Record<string, unknown> | null;
    const gift = mapGift(giftRow);

    const collectionFloor = numberOrNull(collection?.floor_price) ?? gift.collectionFloor;
    const collectionLastSale = numberOrNull(collection?.last_sale_price);

    const saleActivity = trades.map((trade) => ({
      id: `sale:${trade.id}`,
      kind: "sale" as const,
      price: Number(trade.price),
      previousPrice: null,
      actorId: trade.buyer_profile_id ? String(trade.buyer_profile_id) : null,
      actorName: trade.buyer_profile_id ? personName(names, String(trade.buyer_profile_id)) : null,
      createdAt: String(trade.created_at),
    }));
    const listingActivity = listingEvents
      .filter((event) => event.kind !== "sold" && event.kind !== "offer_accepted")
      .map((event) => ({
        id: `listing:${event.id}`,
        kind: event.kind as "listed" | "repriced" | "unlisted" | "expired",
        price: numberOrNull(event.price),
        previousPrice: numberOrNull(event.previous_price),
        actorId: event.actor_profile_id ? String(event.actor_profile_id) : null,
        actorName: event.actor_profile_id ? personName(names, String(event.actor_profile_id)) : null,
        createdAt: String(event.created_at),
      }));
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
      trades: trades.map((trade) => ({
        id: String(trade.id), price: Number(trade.price), createdAt: String(trade.created_at),
        buyerId: String(trade.buyer_profile_id), buyerName: personName(names, String(trade.buyer_profile_id)),
        sellerId: trade.seller_profile_id ? String(trade.seller_profile_id) : null,
        sellerName: trade.seller_profile_id ? personName(names, String(trade.seller_profile_id)) : null,
      })),
      activity,
      candles: [],
      itemStats: {
        tradeCount: Number(itemStats?.trade_count || 0),
        volume: Number(itemStats?.volume || 0),
        highSale: numberOrNull(itemStats?.high_sale),
        lowSale: numberOrNull(itemStats?.low_sale),
      },
      collection: {
        baseName,
        itemCount: Number(collection?.item_count || 0), holderCount: Number(collection?.holder_count || 0), listedCount: Number(collection?.listed_count || 0),
        floorPrice: collectionFloor, lastSalePrice: collectionLastSale, volume24h: Number(collection?.volume_24h || 0), change24h: Number(collection?.change_24h || 0), tradeCount24h: Number(collection?.trade_count_24h || 0),
        volume7d: Number(collection?.volume_7d || 0), tradeCount7d: Number(collection?.trade_count_7d || 0), listedPct: Number(collection?.listed_pct || 0),
        allTimeVolume: Number(collection?.all_time_volume || 0), totalSales: Number(collection?.total_sales || 0), highSale: numberOrNull(collection?.high_sale), externalFloor: numberOrNull(collection?.external_floor),
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
      offers: offers.map((offer) => ({
        id: String(offer.id), amount: Number(offer.amount), status: offer.status, createdAt: String(offer.created_at), expiresAt: offer.expires_at ? String(offer.expires_at) : null,
        buyerId: String(offer.buyer_profile_id), buyerName: personName(names, String(offer.buyer_profile_id)), isMine: String(offer.buyer_profile_id) === String(profile.id),
      })),
    }, { headers: { "cache-control": "private, max-age=0, must-revalidate", "server-timing": `gift-detail;dur=${(performance.now() - startedAt).toFixed(1)}` } });
  } catch (error) {
    console.error("gift detail", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Gift" }, { status: 500 });
  }
}
