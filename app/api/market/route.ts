import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapCoin, mapGift } from "@/lib/mappers";
import { ensureNpcMarketLiquidity } from "@/lib/npc-market";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const scope = request.nextUrl.searchParams.get("scope") === "coins" ? "coins" : "gifts";

  try {
    const watchlistPromise = supabase.from("user_watchlist").select("kind,coin_id,gift_collection").eq("profile_id", profile.id);
    const cartPromise = supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id);

    if (scope === "coins") {
      const [coinsResult, watchlistResult, cartResult] = await Promise.all([
        supabase.from("market_overview").select("*").eq("status", "active").order("volume_24h", { ascending: false }).order("created_at", { ascending: false }).limit(90),
        watchlistPromise,
        cartPromise,
      ]);
      const firstError = coinsResult.error || watchlistResult.error || cartResult.error;
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
        cartIds: (cartResult.data || []).map((row) => String(row.virtual_gift_id)),
      }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
    }

    const queryGiftMarket = () => Promise.all([
      supabase.from("gift_market_overview").select(giftMarketSelect).eq("status", "listed").eq("is_burned", false).not("telegram_name", "is", null).order("listing_price", { ascending: true }).limit(72),
      supabase.from("gift_collection_overview").select("*").order("volume_24h", { ascending: false }).limit(48),
    ] as const);

    let [giftsResult, collectionsResult] = await queryGiftMarket();
    if (giftsResult.error || collectionsResult.error) throw giftsResult.error || collectionsResult.error;

    // Keep a small amount of system liquidity available without blocking the
    // market on external Telegram requests. NPCs can only list real Gift assets
    // that were already verified and imported into gift_assets via Bot API.
    if ((giftsResult.data || []).length < 14) {
      try {
        const liquidity = await ensureNpcMarketLiquidity({ targetListings: 26 });
        if (liquidity.created > 0) {
          [giftsResult, collectionsResult] = await queryGiftMarket();
          if (giftsResult.error || collectionsResult.error) throw giftsResult.error || collectionsResult.error;
        }
      } catch (npcError) {
        console.error("NPC Gift liquidity", npcError);
      }
    }

    const [watchlistResult, cartResult] = await Promise.all([watchlistPromise, cartPromise]);
    if (watchlistResult.error || cartResult.error) throw watchlistResult.error || cartResult.error;
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
      cartIds: (cartResult.data || []).map((row) => String(row.virtual_gift_id)),
    }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("market", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить рынок" }, { status: 500 });
  }
}
