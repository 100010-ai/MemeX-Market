import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { rewardedAdsConfig } from "@/lib/rewarded-ads";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { adsgramModerationMode } from "@/lib/feature-flags";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "rewarded-ad-session", String(profile.id), 8, 300))) {
    return NextResponse.json({ error: "Слишком много попыток запуска рекламы" }, { status: 429 });
  }
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.rewardedAds) return NextResponse.json({ error: "Реклама с наградой временно отключена" }, { status: 503 });

  const config = rewardedAdsConfig();
  if (config.configurationError) return NextResponse.json({ error: config.configurationError }, { status: 503 });
  if (!config.blockId) return NextResponse.json({ error: "Рекламный блок AdsGram пока не подключён" }, { status: 503 });
  if (!config.configured) return NextResponse.json({ error: "Нужно настроить серверное подтверждение рекламной награды" }, { status: 503 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("create_rewarded_ad_session_v045", {
    p_profile_id: profile.id,
    p_provider: "adsgram",
  });
  if (error) {
    console.error("rewarded ad session", { code: error.code, message: error.message });
    const message = /лимит рекламы/i.test(error.message || "")
      ? "Лимит рекламы на сегодня исчерпан"
      : /доступна позже|перезаряд/i.test(error.message || "")
        ? "Следующая реклама будет доступна позже"
        : /сессия уже запущена/i.test(error.message || "")
          ? "Рекламная сессия уже запущена"
          : "Не удалось запустить рекламу";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const payload = (data || {}) as Record<string, unknown>;
  if (adsgramModerationMode() && Number(payload.reward || 0) > 1) {
    const createdSessionId = String(payload.sessionId || "");
    if (validUuidLike(createdSessionId)) await supabase.from("rewarded_ad_sessions").update({ status: "expired" }).eq("id", createdSessionId).eq("profile_id", profile.id).eq("status", "created");
    return NextResponse.json({ error: "Примените миграцию 025: рекламная награда превышает moderation-safe лимит" }, { status: 503 });
  }
  return NextResponse.json({ ...payload, blockId: config.blockId, verificationMode: config.verificationMode }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const sessionId = String(body.sessionId || "").trim();
  if (!validUuidLike(sessionId)) return NextResponse.json({ error: "Некорректная рекламная сессия" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("rewarded_ad_sessions").update({ status: "expired" }).eq("id", sessionId).eq("profile_id", profile.id).eq("status", "created");
  if (error) {
    console.error("rewarded ad cancel", error);
    return NextResponse.json({ error: "Не удалось закрыть рекламную сессию" }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
