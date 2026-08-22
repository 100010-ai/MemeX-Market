import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { calculateCoinQuote } from "@/lib/amm";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "coin-quote", String(profile.id), 180, 60))) return NextResponse.json({ error: "Слишком много запросов котировки" }, { status: 429 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const side = body.side === "buy" ? "buy" : body.side === "sell" ? "sell" : null;
  const amount = Number(body.amount);
  if (!side || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Invalid quote request" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: coin, error } = await supabase.from("coins").select("id,status,token_reserve,quote_reserve,current_price").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!coin || coin.status !== "active") return NextResponse.json({ error: "Coin is not tradeable" }, { status: 404 });

  const quote = calculateCoinQuote({
    side,
    amount,
    tokenReserve: Number(coin.token_reserve),
    quoteReserve: Number(coin.quote_reserve),
    currentPrice: Number(coin.current_price),
  });
  if (!quote) return NextResponse.json({ error: "Trade is too small" }, { status: 400 });
  return NextResponse.json({ quote });
}
export const POST = withApiErrors("app/api/coins/[id]/quote/route.ts:POST", POSTHandler);
