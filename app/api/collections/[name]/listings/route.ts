import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { mapGift } from "@/lib/mappers";
import { safeDecodeURIComponent } from "@/lib/safe-data";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig } from "@/lib/runtime-config";

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

type GiftPage = { gifts?: unknown; nextOffset?: unknown; totalGifts?: unknown };

function parseGiftPage(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as GiftPage : {};
  const gifts = Array.isArray(row.gifts) ? row.gifts : [];
  const nextRaw = row.nextOffset == null ? null : Number(row.nextOffset);
  return {
    gifts,
    nextOffset: nextRaw != null && Number.isInteger(nextRaw) && nextRaw >= 0 ? nextRaw : null,
  };
}

async function GETHandler(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const { name } = await params;
  const baseName = safeDecodeURIComponent(name);
  if (!baseName) return NextResponse.json({ error: "Некорректное имя коллекции" }, { status: 400 });

  const offset = intParam(request.nextUrl.searchParams.get("offset"), 0, 0, 100_000);
  const limit = intParam(request.nextUrl.searchParams.get("limit"), 36, 12, 60);
  const result = await getSupabaseAdmin().rpc("gift_collection_listing_page_v0790", {
    p_base_name: baseName,
    p_offset: offset,
    p_limit: limit,
  });

  if (result.error) return apiFailure(result.error, "Не удалось выполнить запрос");
  const page = parseGiftPage(result.data);
  return NextResponse.json({
    gifts: page.gifts.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? [mapGift(row as Record<string, unknown>)] : []),
    nextOffset: page.nextOffset,
  }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
}
export const GET = withApiErrors("app/api/collections/[name]/listings/route.ts:GET", GETHandler);
