import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: giftRow, error } = await supabase.from("gift_market_overview").select("*").eq("virtual_gift_id", id).single();
  if (error || !giftRow) return NextResponse.json({ error: "Gift not found" }, { status: 404 });

  const [tradesResult, candlesResult, offersResult, collectionResult] = await Promise.all([
    supabase.from("gift_trades").select("id,price,created_at,buyer_profile_id,seller_profile_id").eq("virtual_gift_id", id).order("created_at", { ascending: false }).limit(40),
    supabase.from("gift_collection_candles").select("bucket_start,open,high,low,close,volume").eq("base_name", giftRow.base_name).order("bucket_start", { ascending: true }).limit(240),
    supabase.from("gift_offers").select("id,buyer_profile_id,amount,status,created_at").eq("virtual_gift_id", id).eq("status", "pending").order("amount", { ascending: false }).limit(20),
    supabase.from("gift_collection_overview").select("floor_price,last_sale_price,volume_24h,change_24h,listed_count").eq("base_name", giftRow.base_name).maybeSingle(),
  ]);

  const profileIds = new Set<string>();
  for (const trade of tradesResult.data || []) {
    if (trade.buyer_profile_id) profileIds.add(String(trade.buyer_profile_id));
    if (trade.seller_profile_id) profileIds.add(String(trade.seller_profile_id));
  }
  for (const offer of offersResult.data || []) if (offer.buyer_profile_id) profileIds.add(String(offer.buyer_profile_id));
  const { data: people } = profileIds.size
    ? await supabase.from("profiles").select("id,username,first_name").in("id", [...profileIds])
    : { data: [] as any[] };
  const names = new Map((people || []).map((p: any) => [String(p.id), p.username ? `@${p.username}` : p.first_name || "Trader"]));

  const gift = mapGift(giftRow);
  const isOwner = gift.ownerId === String(profile.id);
  return NextResponse.json({
    gift,
    isOwner,
    balance: Number(profile.balance),
    trades: (tradesResult.data || []).map((t: any) => ({
      id: t.id, price: Number(t.price), createdAt: t.created_at,
      buyerName: names.get(String(t.buyer_profile_id)) || "Trader",
      sellerName: t.seller_profile_id ? names.get(String(t.seller_profile_id)) || "Trader" : null,
    })),
    candles: (candlesResult.data || []).map((c: any) => ({
      time: Math.floor(new Date(c.bucket_start).getTime() / 1000),
      open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume),
    })),
    collection: collectionResult.data ? {
      floorPrice: collectionResult.data.floor_price == null ? null : Number(collectionResult.data.floor_price),
      lastSalePrice: collectionResult.data.last_sale_price == null ? null : Number(collectionResult.data.last_sale_price),
      volume24h: Number(collectionResult.data.volume_24h || 0),
      change24h: Number(collectionResult.data.change_24h || 0),
      listedCount: Number(collectionResult.data.listed_count || 0),
    } : null,
    offers: (offersResult.data || []).map((o: any) => ({
      id: o.id, amount: Number(o.amount), status: o.status, createdAt: o.created_at,
      buyerId: String(o.buyer_profile_id), buyerName: names.get(String(o.buyer_profile_id)) || "Trader",
    })),
  });
}
