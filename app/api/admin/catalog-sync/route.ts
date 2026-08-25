import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { syncGiftCatalog } from "@/lib/gift-catalog";
import { ensureNpcMarketLiquidity } from "@/lib/npc-market";

export const runtime = "nodejs";
export const maxDuration = 60;

async function POSTHandler(request: Request) {
  const admin = await requireAdminProfile("catalog.manage");
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-catalog-sync", String(admin.id), 2, 600))) {
    return NextResponse.json({ error: "Каталог можно обновлять не чаще двух раз за 10 минут" }, { status: 429 });
  }
  try {
    const catalog = await syncGiftCatalog();
    const liquidity = await ensureNpcMarketLiquidity({ force: true, targetListings: 1000 });
    return NextResponse.json({ results: catalog.bot.results, catalog, liquidity });
  } catch (error) {
    console.error("Telegram hybrid catalog sync", error);
    return apiFailure(error, "Не удалось обновить каталог");
  }
}
export const POST = withApiErrors("app/api/admin/catalog-sync/route.ts:POST", POSTHandler);
