import { NextResponse } from "next/server";
import { validateTelegramInitData } from "@/lib/telegram";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { setSession } from "@/lib/session";
import { getProfileSnapshot } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const initData = typeof body.initData === "string" ? body.initData : "";
    if (!initData) return NextResponse.json({ error: "initData is required" }, { status: 400 });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return NextResponse.json({ error: "Telegram bot is not configured" }, { status: 500 });
    const validated = validateTelegramInitData(initData, botToken, 60 * 60 * 24);
    if (!validated.ok) return NextResponse.json({ error: validated.reason }, { status: 401 });

    const { user } = validated;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("sync_telegram_profile", {
      p_telegram_id: user.id,
      p_username: user.username ?? null,
      p_first_name: user.first_name,
      p_last_name: user.last_name ?? null,
      p_photo_url: user.photo_url ?? null,
    });
    if (error || !data) throw error || new Error("Could not sync profile");
    await setSession(user.id);
    return NextResponse.json({ profile: await getProfileSnapshot(data) });
  } catch (error) {
    console.error("telegram auth", error);
    return NextResponse.json({ error: "Telegram authentication failed" }, { status: 500 });
  }
}
