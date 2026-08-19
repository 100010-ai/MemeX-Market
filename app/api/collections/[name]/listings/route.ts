import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name } = await params;
  const baseName = decodeURIComponent(name).trim();
  if (!baseName) return NextResponse.json({ error: "Коллекция не указана" }, { status: 400 });

  const offset = intParam(request.nextUrl.searchParams.get("offset"), 0, 0, 100_000);
  const limit = intParam(request.nextUrl.searchParams.get("limit"), 48, 12, 72);
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("gift_market_overview")
    .select(giftMarketSelect, { count: "exact" })
    .eq("base_name", baseName)
    .eq("is_burned", false)
    .eq("status", "listed")
    .not("telegram_name", "is", null)
    .order("listing_price", { ascending: true })
    .range(offset, offset + limit - 1);

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  const rows = result.data || [];
  const total = result.count || 0;
  return NextResponse.json({
    gifts: rows.map(mapGift),
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
}
