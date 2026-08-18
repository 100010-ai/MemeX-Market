import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin } from "@/lib/mappers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const [coinResult, candleResult, tradeResult, holdingResult] = await Promise.all([
    supabase.from("market_overview").select("*").eq("id", id).single(),
    supabase.from("candles").select("bucket_start,open,high,low,close,volume").eq("coin_id", id).order("bucket_start", { ascending: true }).limit(720),
    supabase.from("trades").select("id,side,quote_amount,token_amount,price,created_at,profiles(username,first_name)").eq("coin_id", id).order("created_at", { ascending: false }).limit(60),
    supabase.from("holdings").select("quantity,cost_basis").eq("coin_id", id).eq("profile_id", profile.id).maybeSingle(),
  ]);
  if (coinResult.error || !coinResult.data) return NextResponse.json({ error: "Coin not found" }, { status: 404 });

  return NextResponse.json({
    coin: mapCoin(coinResult.data),
    candles: (candleResult.data || []).map((c: any) => ({
      time: Math.floor(new Date(c.bucket_start).getTime() / 1000),
      open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume),
    })),
    trades: (tradeResult.data || []).map((t: any) => {
      const trader = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
      return {
        id: t.id, side: t.side, quoteAmount: Number(t.quote_amount), tokenAmount: Number(t.token_amount), price: Number(t.price), createdAt: t.created_at,
        traderName: trader?.username ? `@${trader.username}` : trader?.first_name || "Trader",
      };
    }),
    holding: { quantity: Number(holdingResult.data?.quantity || 0), costBasis: Number(holdingResult.data?.cost_basis || 0) },
    balance: Number(profile.balance),
  });
}
