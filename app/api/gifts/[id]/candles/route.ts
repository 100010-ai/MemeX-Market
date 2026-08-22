import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveGiftAlias } from "@/lib/gifts/resolver";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const gift = await resolveGiftAlias(id);
    if (!gift) return NextResponse.json({ error: "Gift not found" }, { status: 404 });
    const baseName = String(gift.base_name);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("gift_collection_candles")
      .select("bucket_start,open,high,low,close,volume")
      .eq("base_name", baseName)
      .order("bucket_start", { ascending: false })
      .limit(480);
    if (error) throw error;

    return NextResponse.json({
      candles: [...(data || [])].reverse().map((candle) => ({
        time: Math.floor(new Date(candle.bucket_start).getTime() / 1000),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
      })),
    }, { headers: {
      "cache-control": "private, max-age=5, stale-while-revalidate=20",
      "server-timing": `gift-candles;dur=${(performance.now() - startedAt).toFixed(1)}`,
    } });
  } catch (error) {
    console.error("gift candles", error);
    return apiFailure(error, "Could not load chart");
  }
}
export const GET = withApiErrors("app/api/gifts/[id]/candles/route.ts:GET", GETHandler);
