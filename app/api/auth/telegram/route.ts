import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { validateTelegramInitData } from "@/lib/telegram";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSessionConfigStatus, setSession } from "@/lib/session";
import { getProfileSnapshot } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

async function POSTHandler(request: Request) {
  try {
    if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    const initData = typeof body.initData === "string" ? body.initData : "";
    if (!initData) return NextResponse.json({ error: "Не переданы данные мини-приложения Telegram" }, { status: 400 });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return NextResponse.json({ error: "Telegram-бот не настроен" }, { status: 503 });
    if (!getSessionConfigStatus().configured) return NextResponse.json({ error: "Сессии временно недоступны" }, { status: 503 });

    // Validate first so the rate-limit key belongs to the actual signed
    // Telegram user. The old anonymous key accidentally pooled every player
    // into one global bucket and caused random 429 screens.
    const validated = validateTelegramInitData(initData, botToken, 60 * 15);
    if (!validated.ok) {
      return NextResponse.json({ error: "Не удалось подтвердить данные Telegram. Откройте MXM заново." }, { status: 401 });
    }
    const { user, startParam } = validated;

    if (!(await enforceRateLimit(request, "telegram-auth", user.id, 60, 300))) {
      return NextResponse.json({ error: "Слишком много запросов авторизации. Повторите через минуту." }, { status: 429, headers: { "retry-after": "60" } });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("sync_telegram_profile", {
      p_telegram_id: user.id,
      p_username: user.username ?? null,
      p_first_name: user.first_name,
      p_last_name: user.last_name ?? null,
      p_photo_url: user.photo_url ?? null,
    });
    if (error) return apiFailure(error, "Не удалось синхронизировать профиль Telegram", 503);
    if (!data || typeof data !== "object") {
      return NextResponse.json({ error: "Сервис профиля вернул неполные данные" }, { status: 503 });
    }
    if (startParam?.startsWith("ref_")) {
      const code = startParam.slice(4);
      if (/^[A-Za-z0-9_-]{6,32}$/.test(code)) {
        // Referral attribution is useful, but it is not part of authentication.
        // A stale referral migration or transient DB error must never prevent a
        // valid Telegram user from entering the app.
        try {
          const referral = await supabase.rpc("attach_referrer_v046", { p_profile_id: data.id, p_referral_code: code });
          if (referral.error) console.warn("referral attach skipped", referral.error);
        } catch (referralError) {
          console.warn("referral attach skipped", referralError);
        }
      }
    }
    const bannedUntil = data.banned_until ? new Date(String(data.banned_until)).getTime() : null;
    if (data.is_banned && (bannedUntil == null || bannedUntil > Date.now())) {
      return NextResponse.json({ error: data.ban_reason ? `Аккаунт заблокирован: ${String(data.ban_reason)}` : "Аккаунт заблокирован" }, { status: 403 });
    }
    const profile = await getProfileSnapshot(data as Record<string, unknown>);
    await setSession(user.id);
    return NextResponse.json({ profile }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error, "Не удалось выполнить авторизацию Telegram");
  }
}
export const POST = withApiErrors("app/api/auth/telegram/route.ts:POST", POSTHandler);
