import { apiFailure, publicBusinessError, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { recordAppError } from "@/lib/error-inbox";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { MAX_COIN_TRADE_INPUT, MIN_COIN_BUY_TON, parseEconomyAmount } from "@/lib/economy";

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "coin-trade", String(profile.id), 90, 60))) return NextResponse.json({ error: "Слишком много торговых запросов. Подождите минуту." }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.memecoins) return NextResponse.json({ error: "Торговля мемкоинами временно отключена" }, { status: 503 });

  try {
    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    const requestId = String(body.requestId || "");
    const coinId = String(body.coinId || "");
    const side = body.side === "sell" ? "sell" : body.side === "buy" ? "buy" : null;
    const amount = parseEconomyAmount(body.amount);
    const minOutput = parseEconomyAmount(body.minOutput ?? 0);
    const sellAll = side === "sell" && body.sellAll === true;
    if (!validUuidLike(requestId) || !validUuidLike(coinId) || !side || (!sellAll && (amount == null || amount <= 0 || amount > MAX_COIN_TRADE_INPUT)) || minOutput == null || minOutput < 0 || minOutput > 1_000_000_000_000_000_000) {
      return NextResponse.json({ error: "Некорректная сделка" }, { status: 400 });
    }
    if (side === "buy" && !sellAll && amount != null && amount < MIN_COIN_BUY_TON) {
      return NextResponse.json({ error: `Минимальная покупка — ${MIN_COIN_BUY_TON} TON` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const args = {
      p_request_id: requestId,
      p_profile_id: profile.id,
      p_coin_id: coinId,
      p_side: side,
      p_amount: amount != null && amount > 0 ? amount : 0,
      p_sell_all: sellAll,
      p_min_output: minOutput,
    };

    const { data, error } = await supabase.rpc("execute_coin_trade_v3", args);
    if (error) {
      if (/schema cache|does not exist|could not find the function/i.test(error.message || "")) return apiFailure(error, "Торговая схема требует актуальной миграции");
      return NextResponse.json({ error: publicBusinessError(error, "Сделку не удалось выполнить. Обновите данные и повторите попытку.") }, { status: 400 });
    }
    return NextResponse.json({ trade: data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("trade", error);
    await recordAppError("/api/trade", error, String(profile.id));
    return apiFailure(error, "Сделка не выполнена");
  }
}
export const POST = withApiErrors("app/api/trade/route.ts:POST", POSTHandler);
