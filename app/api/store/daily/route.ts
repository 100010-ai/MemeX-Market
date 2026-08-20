import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "premium-daily", String(profile.id), 6, 300))) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите немного." }, { status: 429 });
  }

  const { data, error } = await getSupabaseAdmin().rpc("claim_premium_daily_v200", { p_profile_id: profile.id });
  if (error) {
    const migrationMissing = error.code === "42883" || /claim_premium_daily_v200|schema cache|could not find the function/i.test(error.message || "");
    return NextResponse.json({ error: migrationMissing ? "Примените миграцию экономики Market 2.0" : error.message }, { status: migrationMissing ? 503 : 400 });
  }
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  if (payload.status !== "claimed") {
    const messages: Record<string, string> = { premium_required: "Нужен MXM Premium", already_claimed: "Сегодня бонус уже получен", missing: "Профиль не найден" };
    return NextResponse.json({ error: messages[String(payload.status)] || "Бонус сейчас недоступен" }, { status: 409 });
  }
  const reward = payload.reward && typeof payload.reward === "object" && !Array.isArray(payload.reward)
    ? payload.reward as Record<string, unknown>
    : {};
  return NextResponse.json({ reward: { mxmCoins: Number(reward.mxmCoins || 0), energy: Number(reward.energy || 0) }, mxmCoins: Number(payload.mxmCoins || 0), energy: Number(payload.energy || 0) }, { headers: { "cache-control": "no-store" } });
}
