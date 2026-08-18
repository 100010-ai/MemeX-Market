import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { syncTelegramGifts } from "@/lib/gifts";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!(await enforceRateLimit(request, "gift-sync", String(profile.id), 3, 300))) return NextResponse.json({ error: "Синхронизацию можно запускать не чаще трёх раз за 5 минут" }, { status: 429 });
  try {
    const result = await syncTelegramGifts(String(profile.id), Number(profile.telegram_id));
    return NextResponse.json(result);
  } catch (error) {
    console.error("gift sync", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось синхронизировать Telegram Gifts" }, { status: 502 });
  }
}
