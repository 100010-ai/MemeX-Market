import { NextResponse } from "next/server";
import { getOrCreateSystemProfile, marketCatalogTelegramIds, requireAdminProfile } from "@/lib/admin";
import { syncTelegramGifts } from "@/lib/gifts";

export const runtime = "nodejs";

// Seeds the public catalog by running the exact same verified Telegram sync
// pipeline players use, but against admin-configured source accounts whose
// real unique Gifts land unlisted in a system/treasury profile for review.
export async function POST() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let telegramIds: number[];
  try {
    telegramIds = marketCatalogTelegramIds();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid catalog configuration" }, { status: 500 });
  }
  if (!telegramIds.length) {
    return NextResponse.json({ error: "MARKET_CATALOG_TELEGRAM_IDS is not configured" }, { status: 400 });
  }

  const results: Array<{ telegramId: number; ok: true; result: Awaited<ReturnType<typeof syncTelegramGifts>> } | { telegramId: number; ok: false; error: string }> = [];

  for (const telegramId of telegramIds) {
    try {
      const systemProfile = await getOrCreateSystemProfile(telegramId);
      const result = await syncTelegramGifts(systemProfile.id, telegramId);
      results.push({ telegramId, ok: true, result });
    } catch (error) {
      results.push({ telegramId, ok: false, error: error instanceof Error ? error.message : "Catalog sync failed" });
    }
  }

  return NextResponse.json({ results, syncedAt: new Date().toISOString() });
}
