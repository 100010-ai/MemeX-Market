import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin, mapGift } from "@/lib/mappers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const scope = request.nextUrl.searchParams.get("scope") === "coins" ? "coins" : "gifts";

  try {
    const watchlistPromise = supabase.from("user_watchlist").select("kind,coin_id,gift_collection").eq("profile_id", profile.id);

    if (scope === "coins") {
      const [coinsResult, watchlistResult] = await Promise.all([
        supabase.from("market_overview").select("*").eq("status", "active").order("volume_24h", { ascending: false }).limit(90),
        watchlistPromise,
      ]);
      const firstError = coinsResult.error || watchlistResult.error;
      if (firstError) throw firstError;
      return NextResponse.json({
        scope,
        coins: (coinsResult.data || []).map(mapCoin),
        gifts: [],
        collections: [],
        watchlist: {
          coinIds: (watchlistResult.data || []).filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)),
          giftCollections: (watchlistResult.data || []).filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)),
        },
      }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
    }

    const [giftsResult, collectionsResult, watchlistResult] = await Promise.all([
      supabase.from("gift_market_overview").select("*").eq("status", "listed").eq("is_burned", false).not("telegram_name", "is", null).not("model_file_id", "is", null).not("symbol_file_id", "is", null).order("listing_price", { ascending: true }).limit(120),
      supabase.from("gift_collection_overview").select("*").order("volume_24h", { ascending: false }).limit(80),
      watchlistPromise,
    ]);
    const firstError = giftsResult.error || collectionsResult.error || watchlistResult.error;
    if (firstError) throw firstError;

    const rawGifts = giftsResult.data || [];
    const visibleCollections = new Set(rawGifts.map((row: any) => String(row.base_name)));
    return NextResponse.json({
      scope,
      coins: [],
      gifts: rawGifts.map(mapGift),
      collections: (collectionsResult.data || []).filter((row: any) => visibleCollections.has(String(row.base_name))).map((row: any) => ({
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
    }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("market", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить рынок" }, { status: 500 });
  }
}
