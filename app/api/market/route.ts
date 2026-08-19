import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin, mapGift } from "@/lib/mappers";
import { ensureGenesisGiftMarket } from "@/lib/npc-market";

export const runtime = "nodejs";
export const maxDuration = 60;

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function mapCollection(row: any) {
  return {
    baseName: String(row.base_name),
    itemCount: Number(row.item_count),
    holderCount: Number(row.holder_count),
    listedCount: Number(row.listed_count),
    floorPrice: row.floor_price == null ? null : Number(row.floor_price),
    lastSalePrice: row.last_sale_price == null ? null : Number(row.last_sale_price),
    volume24h: Number(row.volume_24h),
    change24h: Number(row.change_24h),
    tradeCount24h: Number(row.trade_count_24h),
  };
}

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
        totalGifts: 0,
        nextOffset: null,
        marketSeed: null,
        genesis: null,
        watchlist: {
          coinIds: (watchlistResult.data || []).filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)),
          giftCollections: (watchlistResult.data || []).filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)),
        },
        cartIds: (cartResult.data || []).map((row) => String(row.virtual_gift_id)),
      }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
    }

    const offset = intParam(request.nextUrl.searchParams.get("offset"), 0, 0, 100_000);
    const limit = intParam(request.nextUrl.searchParams.get("limit"), 72, 12, 120);
    const suppliedSeed = request.nextUrl.searchParams.get("seed")?.trim();
    const marketSeed = suppliedSeed && /^[a-zA-Z0-9_-]{8,80}$/.test(suppliedSeed)
      ? suppliedSeed
      : crypto.randomBytes(18).toString("base64url");

    // Finite Genesis release: every top-level market opening may release the
    // next small batch, but sold system inventory is NEVER replenished.
    if (offset === 0) {
      try {
        await ensureGenesisGiftMarket({ batchSize: 12 });
      } catch (genesisError) {
        // Catalogue may be empty/not initialized. Market should still load its
        // authoritative DB state instead of replacing it with fake data.
        console.error("Genesis Gift release", genesisError);
      }
    }

    const [giftsResult, countResult, collectionsResult, watchlistResult, cartResult, genesisResult] = await Promise.all([
      supabase.rpc("gift_market_random_page", { p_seed: marketSeed, p_offset: offset, p_limit: limit }),
      supabase.rpc("gift_market_listed_count"),
      supabase.from("gift_collection_overview").select("*").order("volume_24h", { ascending: false }).limit(120),
      watchlistPromise,
      cartPromise,
      supabase.rpc("gift_genesis_public_state"),
    ]);

    const firstError = giftsResult.error || countResult.error || collectionsResult.error || watchlistResult.error || cartResult.error || genesisResult.error;
    if (firstError) throw firstError;

    const rawGifts = (giftsResult.data || []) as any[];
    const totalGifts = Number(countResult.data || 0);
    const nextOffset = offset + rawGifts.length < totalGifts ? offset + rawGifts.length : null;
    const visibleCollections = new Set(rawGifts.map((row) => String(row.base_name)));

    return NextResponse.json({
      scope,
      coins: [],
      gifts: rawGifts.map(mapGift),
      collections: (collectionsResult.data || []).filter((row: any) => visibleCollections.has(String(row.base_name))).map(mapCollection),
      totalGifts,
      nextOffset,
      marketSeed,
      genesis: genesisResult.data || null,
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
