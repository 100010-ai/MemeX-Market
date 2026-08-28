import { NextRequest, NextResponse } from "next/server";
import { apiFailure, withApiErrors } from "@/lib/api-route";
import { requireLocalControl } from "@/lib/local-admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function GETHandler(request: NextRequest) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const raw = (request.nextUrl.searchParams.get("q") || "").trim();
  if (raw.length < 2) return NextResponse.json({ profiles: [], coins: [], gifts: [] });
  const q = raw.slice(0, 80);
  const supabase = getSupabaseAdmin();
  const telegramId = /^\d{4,20}$/.test(q) ? Number(q) : null;

  try {
    const profilesQuery = telegramId
      ? supabase.from("profiles").select("id,telegram_id,username,first_name,balance,xp,is_banned,hidden_from_leaderboard,is_system,created_at").eq("telegram_id", telegramId).limit(12)
      : supabase.from("profiles").select("id,telegram_id,username,first_name,balance,xp,is_banned,hidden_from_leaderboard,is_system,created_at").or(`username.ilike.%${q.replace(/[%_,()]/g, "")}%,first_name.ilike.%${q.replace(/[%_,()]/g, "")}%`).limit(12);

    const [profiles, coins, gifts] = await Promise.all([
      profilesQuery,
      supabase.from("coins").select("id,creator_profile_id,name,symbol,current_price,market_cap,status,hidden_from_market,created_at").or(`name.ilike.%${q.replace(/[%_,()]/g, "")}%,symbol.ilike.%${q.replace(/[%_,()]/g, "")}%`).limit(12),
      supabase.from("gift_market_overview").select("virtual_gift_id,asset_id,base_name,gift_number,owner_profile_id,owner_name,status,listing_price,estimated_value,catalog_source").or(`base_name.ilike.%${q.replace(/[%_,()]/g, "")}%,owner_name.ilike.%${q.replace(/[%_,()]/g, "")}%`).limit(12),
    ]);
    const firstError = profiles.error || coins.error || gifts.error;
    if (firstError) throw firstError;
    return NextResponse.json({ profiles: profiles.data || [], coins: coins.data || [], gifts: gifts.data || [] }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error, "Поиск Control Center недоступен");
  }
}

export const GET = withApiErrors("app/api/control/search/route.ts:GET", GETHandler);
