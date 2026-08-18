import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin, mapGift } from "@/lib/mappers";
import { getMarketActivity } from "@/lib/feed";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  try {
    const [coinsResult, giftsResult, collectionsResult, activity] = await Promise.all([
      supabase.from("market_overview").select("*").eq("status", "active").order("volume_24h", { ascending: false }).limit(100),
      supabase.from("gift_market_overview").select("*").eq("status", "listed").order("listing_price", { ascending: true }).limit(160),
      supabase.from("gift_collection_overview").select("*").order("volume_24h", { ascending: false }).limit(60),
      getMarketActivity(supabase, 16),
    ]);
    const firstError = coinsResult.error || giftsResult.error || collectionsResult.error;
    if (firstError) throw firstError;
    return NextResponse.json({
      coins: (coinsResult.data || []).map(mapCoin),
      gifts: (giftsResult.data || []).map(mapGift),
      collections: (collectionsResult.data || []).map((row: any) => ({
        baseName: row.base_name,
        listedCount: Number(row.listed_count),
        floorPrice: row.floor_price == null ? null : Number(row.floor_price),
        lastSalePrice: row.last_sale_price == null ? null : Number(row.last_sale_price),
        volume24h: Number(row.volume_24h),
        change24h: Number(row.change_24h),
        tradeCount24h: Number(row.trade_count_24h),
      })),
      activity,
    });
  } catch (error) {
    console.error("market", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load market" }, { status: 500 });
  }
}
