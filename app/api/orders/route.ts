import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import type { GiftAsset } from "@/lib/types";

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  try {
    const [outgoingResult, ownedResult, listingsResult] = await Promise.all([
      supabase.from("gift_offers").select("id,virtual_gift_id,buyer_profile_id,amount,status,created_at,expires_at").eq("buyer_profile_id", profile.id).eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("virtual_gifts").select("id").eq("owner_profile_id", profile.id),
      supabase.from("gift_market_overview").select(giftMarketSelect).eq("owner_profile_id", profile.id).eq("status", "listed").or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`).not("telegram_name", "is", null).order("listing_price", { ascending: true }),
    ]);
    const firstError = outgoingResult.error || ownedResult.error || listingsResult.error;
    if (firstError) throw firstError;
    type DbRow = Record<string, unknown>;
    const ownedIds = ((ownedResult.data || []) as DbRow[]).flatMap((row) => typeof row.id === "string" && row.id.trim() ? [row.id.trim()] : []);
    const incomingResult = ownedIds.length
      ? await supabase.from("gift_offers").select("id,virtual_gift_id,buyer_profile_id,amount,status,created_at,expires_at").in("virtual_gift_id", ownedIds).eq("status", "pending").order("amount", { ascending: false })
      : { data: [] as DbRow[], error: null };
    if (incomingResult.error) throw incomingResult.error;

    const allOffers = [...((outgoingResult.data || []) as DbRow[]), ...((incomingResult.data || []) as DbRow[])];
    const giftIds = [...new Set(allOffers.flatMap((row) => typeof row.virtual_gift_id === "string" && row.virtual_gift_id.trim() ? [row.virtual_gift_id.trim()] : []))];
    const buyerIds = [...new Set(allOffers.flatMap((row) => typeof row.buyer_profile_id === "string" && row.buyer_profile_id.trim() ? [row.buyer_profile_id.trim()] : []))];
    const [giftRowsResult, buyersResult] = await Promise.all([
      giftIds.length ? supabase.from("gift_market_overview").select(giftMarketSelect).in("virtual_gift_id", giftIds).not("telegram_name", "is", null) : Promise.resolve({ data: [] as DbRow[], error: null }),
      buyerIds.length ? supabase.from("profiles").select("id,username,first_name").in("id", buyerIds) : Promise.resolve({ data: [] as DbRow[], error: null }),
    ]);
    if (giftRowsResult.error || buyersResult.error) throw giftRowsResult.error || buyersResult.error;
    const gifts = new Map<string, GiftAsset>(((giftRowsResult.data || []) as DbRow[]).map((row) => [String(row.virtual_gift_id), mapGift(row)] as [string, GiftAsset]));
    const names = new Map<string, string>(((buyersResult.data || []) as DbRow[])
      .map((person): [string, string] | null => {
        const id = typeof person.id === "string" ? person.id : "";
        if (!id) return null;
        const username = typeof person.username === "string" && person.username.trim() ? person.username.trim() : null;
        const firstName = typeof person.first_name === "string" && person.first_name.trim() ? person.first_name.trim() : null;
        return [id, username ? `@${username}` : firstName || "Пользователь"];
      })
      .filter((entry): entry is [string, string] => entry !== null));
    const mapOffer = (offer: DbRow) => {
      const virtualGiftId = typeof offer.virtual_gift_id === "string" ? offer.virtual_gift_id.trim() : "";
      const id = typeof offer.id === "string" ? offer.id.trim() : "";
      const buyerId = typeof offer.buyer_profile_id === "string" ? offer.buyer_profile_id.trim() : "";
      const gift = virtualGiftId ? gifts.get(virtualGiftId) : null;
      if (!gift || !id || !buyerId) return null;
      const amount = Number(offer.amount);
      const createdAt = new Date(typeof offer.created_at === "string" ? offer.created_at : 0);
      const expiresAt = offer.expires_at ? new Date(String(offer.expires_at)) : null;
      return {
        id, virtualGiftId, baseName: gift.baseName, number: gift.number,
        amount: Number.isFinite(amount) ? amount : 0,
        status: typeof offer.status === "string" ? offer.status : "pending",
        createdAt: Number.isFinite(createdAt.getTime()) ? createdAt.toISOString() : new Date(0).toISOString(),
        expiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : null,
        buyerId, buyerName: names.get(buyerId) || "Игрок", ownerId: gift.ownerId, ownerName: gift.ownerName, gift,
      };
    };
    const outgoing = ((outgoingResult.data || []) as DbRow[]).map(mapOffer).filter(Boolean);
    const incoming = ((incomingResult.data || []) as DbRow[]).map(mapOffer).filter(Boolean);
    return NextResponse.json({ outgoing, incoming, listings: (listingsResult.data || []).map(mapGift) });
  } catch (error) {
    console.error("orders", error);
    return apiFailure(error, "Не удалось загрузить ордера");
  }
}
export const GET = withApiErrors("app/api/orders/route.ts:GET", GETHandler);
