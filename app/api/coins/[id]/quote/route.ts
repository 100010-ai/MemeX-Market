import { apiFailure, publicBusinessError, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { MAX_COIN_TRADE_INPUT, MIN_COIN_BUY_TON, parseEconomyAmount } from "@/lib/economy";
import { getRuntimeConfig } from "@/lib/runtime-config";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "coin-quote", String(profile.id), 180, 60))) return NextResponse.json({ error: "Слишком много запросов котировки" }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.memecoins) return NextResponse.json({ error: "Торговля мемкоинами временно отключена" }, { status: 503 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный coin ID" }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const side = body.side === "buy" ? "buy" : body.side === "sell" ? "sell" : null;
  const amount = parseEconomyAmount(body.amount);
  if (!side || amount == null || amount <= 0 || amount > MAX_COIN_TRADE_INPUT) return NextResponse.json({ error: "Некорректный запрос котировки" }, { status: 400 });
  if (side === "buy" && amount < MIN_COIN_BUY_TON) return NextResponse.json({ error: `Минимальная покупка — ${MIN_COIN_BUY_TON} TON` }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("quote_coin_trade_v202", {
    p_profile_id: profile.id,
    p_coin_id: id,
    p_side: side,
    p_amount: amount,
  });
  if (error) {
    if (/schema cache|does not exist|could not find the function/i.test(error.message || "")) return apiFailure(error, "Схема котировок требует актуальной миграции");
    return NextResponse.json({ error: publicBusinessError(error, "Не удалось рассчитать котировку") }, { status: 400 });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "Сервер вернул некорректную котировку" }, { status: 502 });
  }
  return NextResponse.json({ quote: data }, { headers: { "cache-control": "no-store" } });
}
export const POST = withApiErrors("app/api/coins/[id]/quote/route.ts:POST", POSTHandler);
