import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { syncConfiguredGiftCatalogSources } from "@/lib/gift-catalog";
import { ensureNpcMarketLiquidity } from "@/lib/npc-market";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-catalog-sync", String(admin.id), 2, 600))) {
    return NextResponse.json({ error: "Каталог можно обновлять не чаще двух раз за 10 минут" }, { status: 429 });
  }
  try {
    const catalog = await syncConfiguredGiftCatalogSources();
    const liquidity = await ensureNpcMarketLiquidity({ force: true, targetListings: 18 });
    return NextResponse.json({ results: catalog.results, catalog, liquidity });
  } catch (error) {
    console.error("Telegram Bot API catalog sync", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось обновить каталог" }, { status: 500 });
  }
}
