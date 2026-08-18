import { NextResponse } from "next/server";
import { getOrCreateSystemProfile, marketCatalogTelegramIds, requireAdminProfile } from "@/lib/admin";
import { syncTelegramGifts } from "@/lib/gifts";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

// Seeds the public catalog by running the exact same verified Telegram sync
// pipeline players use, but against admin-configured source accounts whose
// real unique Gifts land unlisted in a system/treasury profile for review.
export async function POST(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-catalog-sync", String(admin.id), 3, 600))) return NextResponse.json({ error: "Слишком много запросов синхронизации." }, { status: 429 });

  let telegramIds: number[];
  try {
    telegramIds = marketCatalogTelegramIds();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Некорректная конфигурация каталога" }, { status: 500 });
  }
  if (!telegramIds.length) {
    return NextResponse.json({ error: "MARKET_CATALOG_TELEGRAM_IDS не настроен" }, { status: 400 });
  }

  const results: Array<{ telegramId: number; ok: true; result: Awaited<ReturnType<typeof syncTelegramGifts>> } | { telegramId: number; ok: false; error: string }> = [];

  for (const telegramId of telegramIds) {
    try {
      const systemProfile = await getOrCreateSystemProfile(telegramId);
      const result = await syncTelegramGifts(systemProfile.id, telegramId);
      results.push({ telegramId, ok: true, result });
    } catch (error) {
      results.push({ telegramId, ok: false, error: error instanceof Error ? error.message : "Не удалось синхронизировать каталог" });
    }
  }

  return NextResponse.json({ results, syncedAt: new Date().toISOString() });
}
