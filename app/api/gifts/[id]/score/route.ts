import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";
import { resolveGiftAlias } from "@/lib/gifts/resolver";
import { calculateMXMScore } from "@/lib/mxm-score";
import { finiteNumber, nullableNumber } from "@/lib/safe-data";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { id } = await params;
  try {
    const giftRow = await resolveGiftAlias(id);
    if (!giftRow) return NextResponse.json({ error: "Подарок не найден" }, { status: 404 });
    const gift = mapGift(giftRow);
    const supabase = getSupabaseAdmin();
    const [collectionResult, itemResult] = await Promise.all([
      supabase.from("gift_collection_overview").select("item_count,holder_count,listed_count,floor_price,volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct").eq("base_name", gift.baseName).maybeSingle(),
      supabase.rpc("gift_item_market_stats", { p_virtual_gift_id: gift.virtualGiftId }).single(),
    ]);
    const error = collectionResult.error || itemResult.error;
    if (error) throw error;
    const c = (collectionResult.data || {}) as Record<string, unknown>;
    const i = (itemResult.data || {}) as Record<string, unknown>;
    const collection = {
      itemCount: finiteNumber(c.item_count),
      holderCount: finiteNumber(c.holder_count),
      listedCount: finiteNumber(c.listed_count),
      floorPrice: nullableNumber(c.floor_price),
      volume24h: finiteNumber(c.volume_24h),
      change24h: finiteNumber(c.change_24h),
      tradeCount24h: finiteNumber(c.trade_count_24h),
      volume7d: finiteNumber(c.volume_7d),
      tradeCount7d: finiteNumber(c.trade_count_7d),
      listedPct: finiteNumber(c.listed_pct),
    };
    const itemStats = { tradeCount: finiteNumber(i.trade_count) };
    return NextResponse.json({ score: calculateMXMScore({ gift, collection, itemStats }) }, { headers: { "cache-control": "private, max-age=20, stale-while-revalidate=60" } });
  } catch (error) { return apiFailure(error, "Не удалось рассчитать MXM Score"); }
}
export const GET = withApiErrors("app/api/gifts/[id]/score/route.ts:GET", GETHandler);
