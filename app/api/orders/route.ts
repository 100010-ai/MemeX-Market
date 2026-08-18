import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";
import type { GiftAsset } from "@/lib/types";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  try {
    const [outgoingResult, ownedResult, listingsResult] = await Promise.all([
      supabase.from("gift_offers").select("id,virtual_gift_id,buyer_profile_id,amount,status,created_at").eq("buyer_profile_id", profile.id).eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("virtual_gifts").select("id").eq("owner_profile_id", profile.id),
      supabase.from("gift_market_overview").select("*").eq("owner_profile_id", profile.id).eq("status", "listed").not("telegram_name", "is", null).not("model_file_id", "is", null).not("symbol_file_id", "is", null).order("listing_price", { ascending: true }),
    ]);
    const firstError = outgoingResult.error || ownedResult.error || listingsResult.error;
    if (firstError) throw firstError;
    const ownedIds = (ownedResult.data || []).map((row: any) => row.id);
    const incomingResult = ownedIds.length
      ? await supabase.from("gift_offers").select("id,virtual_gift_id,buyer_profile_id,amount,status,created_at").in("virtual_gift_id", ownedIds).eq("status", "pending").order("amount", { ascending: false })
      : { data: [] as any[], error: null };
    if (incomingResult.error) throw incomingResult.error;

    const allOffers = [...(outgoingResult.data || []), ...(incomingResult.data || [])];
    const giftIds = [...new Set(allOffers.map((row: any) => String(row.virtual_gift_id)))];
    const buyerIds = [...new Set(allOffers.map((row: any) => String(row.buyer_profile_id)))];
    const [giftRowsResult, buyersResult] = await Promise.all([
      giftIds.length ? supabase.from("gift_market_overview").select("*").in("virtual_gift_id", giftIds).not("telegram_name", "is", null).not("model_file_id", "is", null).not("symbol_file_id", "is", null) : Promise.resolve({ data: [] as any[], error: null }),
      buyerIds.length ? supabase.from("profiles").select("id,username,first_name").in("id", buyerIds) : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (giftRowsResult.error || buyersResult.error) throw giftRowsResult.error || buyersResult.error;
    const gifts = new Map<string, GiftAsset>((giftRowsResult.data || []).map((row: any) => [String(row.virtual_gift_id), mapGift(row)] as [string, GiftAsset]));
    const names = new Map((buyersResult.data || []).map((person: any) => {
      const name = person.username ? `@${person.username}` : person.first_name;
      if (typeof name !== "string" || !name) throw new Error(`Buyer profile ${person.id} has no display name`);
      return [String(person.id), name] as const;
    }));
    const mapOffer = (offer: any) => {
      const gift = gifts.get(String(offer.virtual_gift_id));
      if (!gift) throw new Error(`Gift for offer ${offer.id} is missing`);
      return {
        id: String(offer.id), virtualGiftId: String(offer.virtual_gift_id), baseName: gift.baseName, number: gift.number,
        amount: Number(offer.amount), status: offer.status, createdAt: String(offer.created_at), buyerId: String(offer.buyer_profile_id),
        buyerName: (() => { const name = names.get(String(offer.buyer_profile_id)); if (!name) throw new Error(`Buyer profile ${offer.buyer_profile_id} is missing`); return name; })(), ownerId: gift.ownerId, ownerName: gift.ownerName, gift,
      };
    };
    return NextResponse.json({ outgoing: (outgoingResult.data || []).map(mapOffer), incoming: (incomingResult.data || []).map(mapOffer), listings: (listingsResult.data || []).map(mapGift) });
  } catch (error) {
    console.error("orders", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить ордера" }, { status: 500 });
  }
}
