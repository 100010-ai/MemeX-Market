import { NextResponse } from "next/server";
import { validateTelegramInitData } from "@/lib/telegram";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { setSession } from "@/lib/session";
import { getProfileSnapshot } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
    const body = await request.json();
    const initData = typeof body.initData === "string" ? body.initData : "";
    if (!initData) return NextResponse.json({ error: "initData is required" }, { status: 400 });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return NextResponse.json({ error: "Telegram bot is not configured" }, { status: 500 });

    // Validate first so the rate-limit key belongs to the actual signed
    // Telegram user. The old anonymous key accidentally pooled every player
    // into one global bucket and caused random 429 screens.
    const validated = validateTelegramInitData(initData, botToken, 60 * 15);
    if (!validated.ok) return NextResponse.json({ error: validated.reason }, { status: 401 });
    const { user } = validated;

    if (!(await enforceRateLimit(request, "telegram-auth", user.id, 12, 300))) {
      return NextResponse.json({ error: "Слишком много попыток входа. Попробуйте через минуту." }, { status: 429, headers: { "retry-after": "60" } });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("sync_telegram_profile", {
      p_telegram_id: user.id,
      p_username: user.username ?? null,
      p_first_name: user.first_name,
      p_last_name: user.last_name ?? null,
      p_photo_url: user.photo_url ?? null,
    });
    if (error || !data) throw error || new Error("Could not sync profile");
    const bannedUntil = data.banned_until ? new Date(String(data.banned_until)).getTime() : null;
    if (data.is_banned && (bannedUntil == null || bannedUntil > Date.now())) {
      return NextResponse.json({ error: data.ban_reason ? `Аккаунт заблокирован: ${String(data.ban_reason)}` : "Аккаунт заблокирован" }, { status: 403 });
    }
    await setSession(user.id);
    return NextResponse.json({ profile: await getProfileSnapshot(data) });
  } catch (error) {
    console.error("telegram auth", error);
    return NextResponse.json({ error: "Telegram authentication failed" }, { status: 500 });
  }
}
