import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { ensureGlobalGiftMarket } from "@/lib/telegram-resale";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-global-catalog-sync", String(admin.id), 2, 600))) {
    return NextResponse.json({ error: "Слишком много запросов обновления каталога." }, { status: 429 });
  }
  try {
    const result = await ensureGlobalGiftMarket({ force: true, reason: `telegram-admin:${admin.telegram_id}` });
    return NextResponse.json({ result, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error("global Telegram resale catalog sync", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось обновить глобальный Telegram каталог" }, { status: 500 });
  }
}
