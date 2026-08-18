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
    const [coinsResult, giftsResult, collectionsResult, watchlistResult, activity] = await Promise.all([
      supabase.from("market_overview").select("*").eq("status", "active").not("creator_profile_id", "is", null).order("volume_24h", { ascending: false }).limit(100),
      supabase.from("gift_market_overview").select("*").eq("status", "listed").eq("is_burned", false).not("telegram_name", "is", null).not("model_file_id", "is", null).not("symbol_file_id", "is", null).order("listing_price", { ascending: true }).limit(240),
      supabase.from("gift_collection_overview").select("*").order("volume_24h", { ascending: false }).limit(100),
      supabase.from("user_watchlist").select("kind,coin_id,gift_collection").eq("profile_id", profile.id),
      getMarketActivity(supabase, 24),
    ]);

    const firstError = coinsResult.error || giftsResult.error || collectionsResult.error || watchlistResult.error;
    if (firstError) throw firstError;

    const rawGifts = giftsResult.data || [];
    const visibleCollections = new Set(rawGifts.map((row: any) => String(row.base_name)));

    return NextResponse.json({
      coins: (coinsResult.data || []).map(mapCoin),
      gifts: rawGifts.map(mapGift),
      collections: (collectionsResult.data || [])
        .filter((row: any) => visibleCollections.has(String(row.base_name)))
        .map((row: any) => ({
          baseName: String(row.base_name),
          itemCount: Number(row.item_count),
          holderCount: Number(row.holder_count),
          listedCount: Number(row.listed_count),
          floorPrice: row.floor_price == null ? null : Number(row.floor_price),
          lastSalePrice: row.last_sale_price == null ? null : Number(row.last_sale_price),
          volume24h: Number(row.volume_24h),
          change24h: Number(row.change_24h),
          tradeCount24h: Number(row.trade_count_24h),
        })),
      watchlist: {
        coinIds: (watchlistResult.data || []).filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)),
        giftCollections: (watchlistResult.data || []).filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)),
      },
      activity,
    });
  } catch (error) {
    console.error("market", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load market" }, { status: 500 });
  }
}
