import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin } from "@/lib/mappers";

function relationOne(value: any, label: string) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) throw new Error(`${label} relation is missing`);
  return row;
}

function profileName(row: any) {
  if (typeof row.username === "string" && row.username.length) return `@${row.username}`;
  if (typeof row.first_name === "string" && row.first_name.length) return row.first_name;
  throw new Error("Profile display name is missing");
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  try {
    const [coinResult, candleResult, tradeResult, holdingResult, topHoldersResult] = await Promise.all([
      supabase.from("market_overview").select("*").eq("id", id).single(),
      supabase.from("candles").select("bucket_start,open,high,low,close,volume").eq("coin_id", id).order("bucket_start", { ascending: true }).limit(3000),
      supabase.from("trades").select("id,profile_id,side,quote_amount,token_amount,price,created_at,profiles(username,first_name)").eq("coin_id", id).order("created_at", { ascending: false }).limit(100),
      supabase.from("holdings").select("quantity,cost_basis").eq("coin_id", id).eq("profile_id", profile.id).maybeSingle(),
      supabase.from("holdings").select("profile_id,quantity,profiles(username,first_name)").eq("coin_id", id).gt("quantity", 0).order("quantity", { ascending: false }).limit(10),
    ]);
    if (coinResult.error || !coinResult.data) return NextResponse.json({ error: "Coin not found" }, { status: 404 });
    const otherError = candleResult.error || tradeResult.error || holdingResult.error || topHoldersResult.error;
    if (otherError) throw otherError;
    return NextResponse.json({
      coin: mapCoin(coinResult.data),
      candles: (candleResult.data || []).map((candle: any) => ({
        time: Math.floor(new Date(candle.bucket_start).getTime() / 1000),
        open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume),
      })),
      trades: (tradeResult.data || []).map((trade: any) => {
        const trader = relationOne(trade.profiles, "Trade profile");
        return {
          id: String(trade.id), side: trade.side, quoteAmount: Number(trade.quote_amount), tokenAmount: Number(trade.token_amount), price: Number(trade.price), createdAt: String(trade.created_at),
          traderId: String(trade.profile_id), traderName: profileName(trader),
        };
      }),
      holding: { quantity: Number(holdingResult.data?.quantity || 0), costBasis: Number(holdingResult.data?.cost_basis || 0) },
      balance: Number(profile.balance),
      topHolders: (topHoldersResult.data || []).map((holder: any) => {
        const person = relationOne(holder.profiles, "Holder profile");
        return { id: String(holder.profile_id), name: profileName(person), quantity: Number(holder.quantity) };
      }),
    });
  } catch (error) {
    console.error("coin detail", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load coin" }, { status: 500 });
  }
}
