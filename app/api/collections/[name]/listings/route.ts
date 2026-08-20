import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name } = await params;
  const baseName = decodeURIComponent(name).trim();
  if (!baseName) return NextResponse.json({ error: "Коллекция не указана" }, { status: 400 });

  const offset = intParam(request.nextUrl.searchParams.get("offset"), 0, 0, 100_000);
  const limit = intParam(request.nextUrl.searchParams.get("limit"), 36, 12, 60);
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const result = await supabase
    .from("gift_market_overview")
    .select(giftMarketSelect)
    .eq("base_name", baseName)
    .eq("is_burned", false)
    .eq("status", "listed")
    .or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`)
    .not("telegram_name", "is", null)
    .order("listing_price", { ascending: true })
    .range(offset, offset + limit);

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  const rows = result.data || [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return NextResponse.json({
    gifts: pageRows.map(mapGift),
    nextOffset: hasMore ? offset + pageRows.length : null,
  }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
}
