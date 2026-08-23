import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { calculateCoinQuote } from "@/lib/amm";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { MAX_COIN_TRADE_INPUT, MIN_COIN_BUY_TON, parseEconomyAmount } from "@/lib/economy";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "coin-quote", String(profile.id), 180, 60))) return NextResponse.json({ error: "Слишком много запросов котировки" }, { status: 429 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный coin ID" }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const side = body.side === "buy" ? "buy" : body.side === "sell" ? "sell" : null;
  const amount = parseEconomyAmount(body.amount);
  if (!side || amount == null || amount <= 0 || amount > MAX_COIN_TRADE_INPUT) return NextResponse.json({ error: "Некорректный запрос котировки" }, { status: 400 });
  if (side === "buy" && amount < MIN_COIN_BUY_TON) return NextResponse.json({ error: `Минимальная покупка — ${MIN_COIN_BUY_TON} TON` }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const [coinResult, settingsResult] = await Promise.all([
    supabase.from("coins").select("id,status,token_reserve,quote_reserve,current_price").eq("id", id).maybeSingle(),
    supabase.from("economy_settings").select("coin_total_fee_bps").eq("singleton", true).maybeSingle(),
  ]);
  if (coinResult.error || settingsResult.error) return apiFailure(coinResult.error || settingsResult.error, "Не удалось выполнить запрос");
  const coin = coinResult.data;
  if (!coin || coin.status !== "active") return NextResponse.json({ error: "Этот мемкоин недоступен для торговли" }, { status: 404 });

  const feeRate = Math.max(0, Number(settingsResult.data?.coin_total_fee_bps || 0)) / 10_000;
  const quote = calculateCoinQuote({
    side,
    amount,
    tokenReserve: Number(coin.token_reserve),
    quoteReserve: Number(coin.quote_reserve),
    currentPrice: Number(coin.current_price),
    feeRate,
  });
  if (!quote) return NextResponse.json({ error: "Сумма сделки слишком мала" }, { status: 400 });
  return NextResponse.json({ quote });
}
export const POST = withApiErrors("app/api/coins/[id]/quote/route.ts:POST", POSTHandler);
