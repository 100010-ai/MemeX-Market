import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getProfileSnapshot, requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin } from "@/lib/mappers";

type DbRow = Record<string, unknown>;

function relationOne(value: unknown, label: string): DbRow {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return {};
  return row as DbRow;
}

function profileName(row: DbRow) {
  if (typeof row.username === "string" && row.username.length) return `@${row.username}`;
  if (typeof row.first_name === "string" && row.first_name.length) return row.first_name;
  return "Пользователь";
}

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  try {
    const [coinResult, candleResult, tradeResult, holdingResult, topHoldersResult, watchedResult, profileSnapshot, economyResult, earlyBuyersResult] = await Promise.all([
      supabase.from("market_overview").select("id,creator_profile_id,name,symbol,image_url,description,current_price,market_cap,volume_24h,change_24h,holder_count,trade_count_24h,created_at,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,total_supply,token_reserve,quote_reserve").eq("id", id).single(),
      supabase.from("candles").select("bucket_start,open,high,low,close,volume").eq("coin_id", id).order("bucket_start", { ascending: false }).limit(480),
      supabase.from("trades").select("id,profile_id,side,quote_amount,token_amount,price,created_at,profiles(username,first_name)").eq("coin_id", id).order("created_at", { ascending: false }).limit(30),
      supabase.from("holdings").select("quantity,cost_basis").eq("coin_id", id).eq("profile_id", profile.id).maybeSingle(),
      supabase.from("holdings").select("profile_id,quantity,profiles(username,first_name)").eq("coin_id", id).gt("quantity", 0).order("quantity", { ascending: false }).limit(10),
      supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "coin").eq("coin_id", id).maybeSingle(),
      getProfileSnapshot(profile as Record<string, unknown>),
      supabase.rpc("coin_economy_snapshot_v200", { p_profile_id: profile.id, p_coin_id: id }),
      supabase.from("coin_early_buyers").select("profile_id,ordinal").eq("coin_id", id),
    ]);
    if (coinResult.error || !coinResult.data) return NextResponse.json({ error: "Coin not found" }, { status: 404 });
    const otherError = candleResult.error || tradeResult.error || holdingResult.error || topHoldersResult.error || watchedResult.error || economyResult.error || earlyBuyersResult.error;
    if (otherError) throw otherError;
    const economy = economyResult.data && typeof economyResult.data === "object" && !Array.isArray(economyResult.data)
      ? economyResult.data as Record<string, unknown>
      : {};
    const holdingQuantity = Number(holdingResult.data?.quantity || 0);
    const earlyOrdinals = new Map((earlyBuyersResult.data || []).map((row) => [String(row.profile_id), Number(row.ordinal)]));
    return NextResponse.json({
      coin: mapCoin(coinResult.data),
      candles: [...((candleResult.data || []) as DbRow[])].reverse().map((candle) => ({
        time: Math.floor(new Date(String(candle.bucket_start)).getTime() / 1000),
        open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume),
      })),
      trades: ((tradeResult.data || []) as DbRow[]).map((trade) => {
        const trader = relationOne(trade.profiles, "Trade profile");
        return {
          id: String(trade.id), side: trade.side, quoteAmount: Number(trade.quote_amount), tokenAmount: Number(trade.token_amount), price: Number(trade.price), createdAt: String(trade.created_at),
          traderId: String(trade.profile_id), traderName: profileName(trader), genesisOrdinal: earlyOrdinals.get(String(trade.profile_id)) || null,
        };
      }),
      holding: { quantity: holdingQuantity, availableQuantity: Number(economy.availableQuantity ?? holdingQuantity), costBasis: Number(holdingResult.data?.cost_basis || 0) },
      economy,
      balance: profileSnapshot.balance,
      availableBalance: profileSnapshot.availableBalance,
      reservedBalance: profileSnapshot.reservedBalance,
      watched: Boolean(watchedResult.data),
      topHolders: ((topHoldersResult.data || []) as DbRow[]).map((holder) => {
        const person = relationOne(holder.profiles, "Holder profile");
        return { id: String(holder.profile_id), name: profileName(person), quantity: Number(holder.quantity), genesisOrdinal: earlyOrdinals.get(String(holder.profile_id)) || null };
      }),
    }, { headers: { "server-timing": `coin-detail;dur=${(performance.now() - startedAt).toFixed(1)}`, "cache-control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("coin detail", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load coin" }, { status: 500 });
  }
}
export const GET = withApiErrors("app/api/coins/[id]/route.ts:GET", GETHandler);
