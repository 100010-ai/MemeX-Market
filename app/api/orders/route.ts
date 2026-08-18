import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const [outgoingResult, ownedResult, listingsResult] = await Promise.all([
    supabase.from("gift_offers").select("id,virtual_gift_id,buyer_profile_id,amount,status,created_at").eq("buyer_profile_id", profile.id).eq("status", "pending").order("created_at", { ascending: false }),
    supabase.from("virtual_gifts").select("id").eq("owner_profile_id", profile.id),
    supabase.from("gift_market_overview").select("*").eq("owner_profile_id", profile.id).eq("status", "listed").order("listing_price", { ascending: true }),
  ]);
  const ownedIds = (ownedResult.data || []).map((x: any) => x.id);
  const { data: incoming } = ownedIds.length
    ? await supabase.from("gift_offers").select("id,virtual_gift_id,buyer_profile_id,amount,status,created_at").in("virtual_gift_id", ownedIds).eq("status", "pending").order("amount", { ascending: false })
    : { data: [] as any[] };

  const allOffers = [...(outgoingResult.data || []), ...(incoming || [])];
  const giftIds = [...new Set(allOffers.map((x: any) => String(x.virtual_gift_id)))];
  const buyerIds = [...new Set(allOffers.map((x: any) => String(x.buyer_profile_id)))];
  const [{ data: giftRows }, { data: buyers }] = await Promise.all([
    giftIds.length ? supabase.from("gift_market_overview").select("*").in("virtual_gift_id", giftIds) : Promise.resolve({ data: [] as any[], error: null }),
    buyerIds.length ? supabase.from("profiles").select("id,username,first_name").in("id", buyerIds) : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  const gifts = new Map((giftRows || []).map((r: any) => [String(r.virtual_gift_id), mapGift(r)]));
  const names = new Map((buyers || []).map((p: any) => [String(p.id), p.username ? `@${p.username}` : p.first_name || "Trader"]));
  const mapOffer = (o: any) => {
    const gift = gifts.get(String(o.virtual_gift_id));
    return {
      id: String(o.id), virtualGiftId: String(o.virtual_gift_id), baseName: gift?.baseName || "Gift", number: gift?.number || 0,
      amount: Number(o.amount), status: o.status, createdAt: o.created_at, buyerId: String(o.buyer_profile_id),
      buyerName: names.get(String(o.buyer_profile_id)) || "Trader", ownerId: gift?.ownerId || null, ownerName: gift?.ownerName || null,
    };
  };

  return NextResponse.json({
    outgoing: (outgoingResult.data || []).map(mapOffer),
    incoming: (incoming || []).map(mapOffer),
    listings: (listingsResult.data || []).map(mapGift),
  });
}
