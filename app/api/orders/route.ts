import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import type { GiftAsset } from "@/lib/types";

const OFFER_LIMIT = 120;
const LISTING_LIMIT = 500;
type DbRow = Record<string, unknown>;

function cleanId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeIso(value: unknown) {
  if (typeof value !== "string" || !value) return new Date(0).toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  try {
    // seller_profile_id is maintained by the final production migration. It
    // removes the old O(number_of_owned_gifts) ID collection + huge `.in()`
    // request and also gives Realtime a player-scoped filter.
    const [outgoingResult, incomingResult, listingsResult] = await Promise.all([
      supabase.from("gift_offers")
        .select("id,virtual_gift_id,buyer_profile_id,seller_profile_id,amount,status,created_at,expires_at", { count: "exact" })
        .eq("buyer_profile_id", profile.id)
        .eq("status", "pending")
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order("created_at", { ascending: false })
        .limit(OFFER_LIMIT),
      supabase.from("gift_offers")
        .select("id,virtual_gift_id,buyer_profile_id,seller_profile_id,amount,status,created_at,expires_at", { count: "exact" })
        .eq("seller_profile_id", profile.id)
        .eq("status", "pending")
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order("amount", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(OFFER_LIMIT),
      supabase.from("gift_market_overview")
        .select(giftMarketSelect, { count: "exact" })
        .eq("owner_profile_id", profile.id)
        .eq("status", "listed")
        .or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`)
        .not("telegram_name", "is", null)
        .order("listing_price", { ascending: true })
        .limit(LISTING_LIMIT),
    ]);
    const firstError = outgoingResult.error || incomingResult.error || listingsResult.error;
    if (firstError) throw firstError;

    const outgoingRows = (outgoingResult.data || []) as DbRow[];
    const incomingRows = (incomingResult.data || []) as DbRow[];
    const allOffers = [...outgoingRows, ...incomingRows];
    const giftIds = [...new Set(allOffers.map((row) => cleanId(row.virtual_gift_id)).filter(Boolean))];
    const buyerIds = [...new Set(allOffers.map((row) => cleanId(row.buyer_profile_id)).filter(Boolean))];

    const [giftRowsResult, buyersResult] = await Promise.all([
      giftIds.length
        ? supabase.from("gift_market_overview").select(giftMarketSelect).in("virtual_gift_id", giftIds).not("telegram_name", "is", null)
        : Promise.resolve({ data: [] as DbRow[], error: null }),
      buyerIds.length
        ? supabase.from("profiles").select("id,username,first_name").in("id", buyerIds)
        : Promise.resolve({ data: [] as DbRow[], error: null }),
    ]);
    if (giftRowsResult.error || buyersResult.error) throw giftRowsResult.error || buyersResult.error;

    const gifts = new Map<string, GiftAsset>();
    for (const row of (giftRowsResult.data || []) as DbRow[]) {
      const id = cleanId(row.virtual_gift_id);
      if (!id) continue;
      const mapped = mapGift(row);
      if (mapped.virtualGiftId) gifts.set(id, mapped);
    }

    const names = new Map<string, string>();
    for (const person of (buyersResult.data || []) as DbRow[]) {
      const id = cleanId(person.id);
      if (!id) continue;
      const username = typeof person.username === "string" && person.username.trim() ? person.username.trim() : null;
      const firstName = typeof person.first_name === "string" && person.first_name.trim() ? person.first_name.trim() : null;
      names.set(id, username ? `@${username}` : firstName || "Пользователь");
    }

    const mapOffer = (offer: DbRow) => {
      const virtualGiftId = cleanId(offer.virtual_gift_id);
      const id = cleanId(offer.id);
      const buyerId = cleanId(offer.buyer_profile_id);
      const gift = virtualGiftId ? gifts.get(virtualGiftId) : null;
      if (!gift || !id || !buyerId) return null;
      const expiresAt = typeof offer.expires_at === "string" && Number.isFinite(Date.parse(offer.expires_at))
        ? new Date(offer.expires_at).toISOString()
        : null;
      return {
        id,
        virtualGiftId,
        baseName: gift.baseName,
        number: gift.number,
        amount: Math.max(0, finite(offer.amount)),
        status: typeof offer.status === "string" ? offer.status : "pending",
        createdAt: safeIso(offer.created_at),
        expiresAt,
        buyerId,
        buyerName: names.get(buyerId) || "Игрок",
        ownerId: gift.ownerId,
        ownerName: gift.ownerName,
        gift,
      };
    };

    const outgoing = outgoingRows.map(mapOffer).filter((row): row is NonNullable<typeof row> => row !== null);
    const incoming = incomingRows.map(mapOffer).filter((row): row is NonNullable<typeof row> => row !== null);
    const listings = (listingsResult.data || []).map((row) => mapGift(row as DbRow)).filter((gift) => Boolean(gift.virtualGiftId));

    return NextResponse.json({
      outgoing,
      incoming,
      listings,
      counts: {
        outgoing: Number(outgoingResult.count || outgoing.length),
        incoming: Number(incomingResult.count || incoming.length),
        listings: Number(listingsResult.count || listings.length),
      },
      truncated: {
        outgoing: Number(outgoingResult.count || 0) > outgoing.length,
        incoming: Number(incomingResult.count || 0) > incoming.length,
        listings: Number(listingsResult.count || 0) > listings.length,
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("orders", error);
    return apiFailure(error, "Не удалось загрузить заявки");
  }
}

export const GET = withApiErrors("app/api/orders/route.ts:GET", GETHandler);
