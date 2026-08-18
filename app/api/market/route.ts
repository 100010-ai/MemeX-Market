import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin, mapGift } from "@/lib/mappers";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();

  const [coinsResult, giftsResult, collectionsResult, coinActivityResult, giftActivityResult] = await Promise.all([
    supabase.from("market_overview").select("*").eq("status", "active").order("volume_24h", { ascending: false }).limit(60),
    supabase.from("gift_market_overview").select("*").eq("status", "listed").order("listing_price", { ascending: true }).limit(80),
    supabase.from("gift_collection_overview").select("*").order("volume_24h", { ascending: false }).limit(30),
    supabase.from("trades").select("id,side,quote_amount,created_at,coins(symbol),profiles(username,first_name)").order("created_at", { ascending: false }).limit(8),
    supabase.from("gift_trades").select("id,price,created_at,gift_assets(base_name,gift_number),profiles!gift_trades_buyer_profile_id_fkey(username,first_name)").order("created_at", { ascending: false }).limit(8),
  ]);

  const firstError = [coinsResult.error, giftsResult.error, collectionsResult.error].find(Boolean);
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  const activity = [
    ...(coinActivityResult.data || []).map((row: any) => {
      const coin = Array.isArray(row.coins) ? row.coins[0] : row.coins;
      const user = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: `coin-${row.id}`,
        kind: "coin" as const,
        label: `${user?.username ? `@${user.username}` : user?.first_name || "Trader"} ${row.side}`,
        detail: `$${coin?.symbol || "COIN"}`,
        amount: Number(row.quote_amount),
        createdAt: row.created_at,
      };
    }),
    ...(giftActivityResult.data || []).map((row: any) => {
      const gift = Array.isArray(row.gift_assets) ? row.gift_assets[0] : row.gift_assets;
      const user = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: `gift-${row.id}`,
        kind: "gift" as const,
        label: `${user?.username ? `@${user.username}` : user?.first_name || "Trader"} bought`,
        detail: `${gift?.base_name || "Gift"} #${gift?.gift_number || ""}`,
        amount: Number(row.price),
        createdAt: row.created_at,
      };
    }),
  ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 10);

  return NextResponse.json({
    coins: (coinsResult.data || []).map(mapCoin),
    gifts: (giftsResult.data || []).map(mapGift),
    collections: (collectionsResult.data || []).map((row: any) => ({
      baseName: row.base_name,
      listedCount: Number(row.listed_count ?? 0),
      floorPrice: row.floor_price === null ? null : Number(row.floor_price),
      lastSalePrice: row.last_sale_price === null ? null : Number(row.last_sale_price),
      volume24h: Number(row.volume_24h ?? 0),
      change24h: Number(row.change_24h ?? 0),
    })),
    activity,
  });
}
