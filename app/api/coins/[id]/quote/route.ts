import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const FEE_RATE = 0.005;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const side = body.side === "buy" ? "buy" : body.side === "sell" ? "sell" : null;
  const amount = Number(body.amount);
  if (!side || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Invalid quote request" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: coin, error } = await supabase
    .from("coins")
    .select("id,status,token_reserve,quote_reserve,current_price")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!coin || coin.status !== "active") return NextResponse.json({ error: "Coin is not tradeable" }, { status: 404 });

  const tokenReserve = Number(coin.token_reserve);
  const quoteReserve = Number(coin.quote_reserve);
  const currentPrice = Number(coin.current_price);
  if (![tokenReserve, quoteReserve, currentPrice].every(Number.isFinite) || tokenReserve <= 0 || quoteReserve <= 0 || currentPrice <= 0) {
    return NextResponse.json({ error: "Coin reserves are invalid" }, { status: 500 });
  }

  const k = tokenReserve * quoteReserve;
  if (side === "buy") {
    const feeAmount = amount * FEE_RATE;
    const quoteNet = amount - feeAmount;
    const newQuote = quoteReserve + quoteNet;
    const newToken = k / newQuote;
    const outputAmount = tokenReserve - newToken;
    if (!Number.isFinite(outputAmount) || outputAmount <= 0) return NextResponse.json({ error: "Trade is too small" }, { status: 400 });
    const executionPrice = amount / outputAmount;
    const projectedPrice = newQuote / newToken;
    return NextResponse.json({ quote: {
      side,
      inputAmount: amount,
      outputAmount,
      executionPrice,
      currentPrice,
      priceImpact: Math.max(0, ((executionPrice / currentPrice) - 1) * 100),
      feeAmount,
      projectedPrice,
    } });
  }

  const newToken = tokenReserve + amount;
  const newQuote = k / newToken;
  const quoteGross = quoteReserve - newQuote;
  const feeAmount = quoteGross * FEE_RATE;
  const outputAmount = quoteGross - feeAmount;
  if (!Number.isFinite(outputAmount) || outputAmount <= 0) return NextResponse.json({ error: "Trade is too small" }, { status: 400 });
  const executionPrice = outputAmount / amount;
  const projectedPrice = newQuote / newToken;
  return NextResponse.json({ quote: {
    side,
    inputAmount: amount,
    outputAmount,
    executionPrice,
    currentPrice,
    priceImpact: Math.max(0, (1 - (executionPrice / currentPrice)) * 100),
    feeAmount,
    projectedPrice,
  } });
}
