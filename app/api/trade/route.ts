import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "coin-trade", String(profile.id), 90, 60))) return NextResponse.json({ error: "Слишком много торговых запросов. Подождите минуту." }, { status: 429 });

  try {
    const body = await request.json();
    const coinId = String(body.coinId || "");
    const side = body.side === "sell" ? "sell" : body.side === "buy" ? "buy" : null;
    const amount = Number(body.amount);
    const sellAll = side === "sell" && body.sellAll === true;
    if (!coinId || !side || (!sellAll && (!Number.isFinite(amount) || amount <= 0))) return NextResponse.json({ error: "Некорректная сделка" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const fn = side === "buy" ? "buy_coin" : sellAll ? "sell_coin_all" : "sell_coin";
    const args = side === "buy"
      ? { p_profile_id: profile.id, p_coin_id: coinId, p_quote_amount: amount }
      : sellAll
        ? { p_profile_id: profile.id, p_coin_id: coinId }
        : { p_profile_id: profile.id, p_coin_id: coinId, p_token_amount: amount };

    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      const message = error.message.includes("Insufficient token balance") ? "Недостаточно токенов" : error.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ trade: data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("trade", error);
    return NextResponse.json({ error: "Сделка не выполнена" }, { status: 500 });
  }
}
