import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";

function cleanTerm(value: string) {
  return value.trim().replace(/[,%()]/g, " ").replace(/\s+/g, " ").slice(0, 64);
}

export async function GET(request: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await enforceRateLimit(request, "market-search", String(session.telegramId), 60, 60))) return NextResponse.json({ error: "Слишком много поисковых запросов" }, { status: 429 });

  const q = cleanTerm(request.nextUrl.searchParams.get("q") || "");
  if (q.length < 2) return NextResponse.json({ gifts: [] });

  const supabase = getSupabaseAdmin();
  const baseQuery = () => supabase
    .from("gift_market_overview")
    .select(giftMarketSelect)
    .eq("status", "listed")
    .eq("is_burned", false)
    .not("telegram_name", "is", null);

  const pattern = `%${q}%`;
  const requests = [
    baseQuery().ilike("base_name", pattern).order("listing_price", { ascending: true }).limit(24),
    baseQuery().ilike("model_name", pattern).order("listing_price", { ascending: true }).limit(16),
    baseQuery().ilike("backdrop_name", pattern).order("listing_price", { ascending: true }).limit(12),
    baseQuery().ilike("symbol_name", pattern).order("listing_price", { ascending: true }).limit(12),
  ];

  if (/^#?\d+$/.test(q)) {
    const number = Number(q.replace("#", ""));
    if (Number.isSafeInteger(number) && number > 0) requests.unshift(baseQuery().eq("gift_number", number).order("listing_price", { ascending: true }).limit(24));
  }

  const results = await Promise.all(requests);
  const error = results.find((result) => result.error)?.error;
  if (error) {
    console.error("market gift search", error);
    return NextResponse.json({ error: "Не удалось выполнить поиск" }, { status: 500 });
  }

  const unique = new Map<string, Record<string, unknown>>();
  for (const result of results) {
    for (const row of result.data || []) {
      const record = row as unknown as Record<string, unknown>;
      const id = String(record.virtual_gift_id || "");
      if (id && !unique.has(id)) unique.set(id, record);
      if (unique.size >= 60) break;
    }
    if (unique.size >= 60) break;
  }

  return NextResponse.json({ gifts: [...unique.values()].map((row) => mapGift(row as Record<string, any>)) }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
}
