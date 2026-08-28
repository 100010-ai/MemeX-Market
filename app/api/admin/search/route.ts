import { NextRequest, NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { apiFailure, withApiErrors } from "@/lib/api-route";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function cleanQuery(value: string) { return value.trim().replace(/[,%()]/g, " ").replace(/\s+/g, " ").slice(0, 80); }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

async function GETHandler(request: NextRequest) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  const q = cleanQuery(request.nextUrl.searchParams.get("q") || "");
  if (q.length < 2) return NextResponse.json({ results: [] }, { headers: { "cache-control": "private, no-store" } });

  const supabase = getSupabaseAdmin();
  const pattern = `%${q}%`;
  const numeric = /^\d{3,20}$/.test(q) ? q : null;

  try {
    const profileQuery = supabase.from("profiles")
      .select("id,telegram_id,username,first_name,balance,mxm_coins,energy,max_energy,xp,is_banned,hidden_from_leaderboard,premium_until,stars_spent")
      .eq("is_system", false)
      .or(`username.ilike.${pattern},first_name.ilike.${pattern}${numeric ? `,telegram_id.eq.${numeric}` : ""}`)
      .limit(8);
    const coinQuery = supabase.from("coins")
      .select("id,name,symbol,current_price,market_cap,status,hidden_from_market,creator_profile_id")
      .or(`name.ilike.${pattern},symbol.ilike.${pattern}${isUuid(q) ? `,id.eq.${q}` : ""}`)
      .limit(8);
    const giftQuery = supabase.from("gift_assets")
      .select("id,base_name,gift_number,model_name,symbol_name,backdrop_name,catalog_source,chain_verified")
      .or(`base_name.ilike.${pattern},model_name.ilike.${pattern},symbol_name.ilike.${pattern}${/^\d+$/.test(q) ? `,gift_number.eq.${q}` : ""}`)
      .limit(8);
    const storeQuery = supabase.from("store_products")
      .select("sku,title,category,stars_price,active,badge")
      .or(`sku.ilike.${pattern},title.ilike.${pattern}`)
      .limit(8);
    const caseQuery = supabase.from("case_definitions")
      .select("sku,title,tier,remaining_supply,active")
      .or(`sku.ilike.${pattern},title.ilike.${pattern}`)
      .limit(8);

    const [profiles, coins, gifts, products, cases] = await Promise.all([profileQuery, coinQuery, giftQuery, storeQuery, caseQuery]);
    const firstError = [profiles,coins,gifts,products,cases].find((item) => item.error)?.error;
    if (firstError) throw firstError;

    const results = [
      ...(profiles.data || []).map((row) => ({
        type: "profile", id: String(row.id), title: row.username ? `@${row.username}` : String(row.first_name || "Игрок"),
        subtitle: `TG ${row.telegram_id} · ${Number(row.balance || 0).toLocaleString("ru-RU")} TON · ${Number(row.mxm_coins || 0).toLocaleString("ru-RU")} MXM`,
        status: row.is_banned ? "banned" : row.premium_until && new Date(String(row.premium_until)).getTime() > Date.now() ? "premium" : "active",
        href: `/u/${row.id}`,
        meta: row,
      })),
      ...(coins.data || []).map((row) => ({
        type: "coin", id: String(row.id), title: `${row.name} · $${row.symbol}`,
        subtitle: `Цена ${Number(row.current_price || 0).toLocaleString("ru-RU")} · MC ${Number(row.market_cap || 0).toLocaleString("ru-RU")}`,
        status: row.hidden_from_market ? "hidden" : String(row.status || "active"), href: `/coin/${row.id}`, meta: row,
      })),
      ...(gifts.data || []).map((row) => ({
        type: "gift", id: String(row.id), title: `${row.base_name} #${row.gift_number}`,
        subtitle: [row.model_name,row.symbol_name,row.backdrop_name].filter(Boolean).join(" · "),
        status: row.chain_verified ? "verified" : String(row.catalog_source || "catalog"), href: `/gifts/${row.id}`, meta: row,
      })),
      ...(products.data || []).map((row) => ({
        type: "product", id: String(row.sku), title: String(row.title), subtitle: `${row.category} · ${row.stars_price} Stars`,
        status: row.active ? "active" : "disabled", href: "/admin/legacy", meta: row,
      })),
      ...(cases.data || []).map((row) => ({
        type: "case", id: String(row.sku), title: String(row.title), subtitle: `${row.tier} · остаток ${row.remaining_supply ?? "∞"}`,
        status: row.active ? "active" : "disabled", href: "/cases", meta: row,
      })),
    ].slice(0, 32);

    return NextResponse.json({ query: q, results }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("admin global search", error);
    return apiFailure(error, "Поиск временно недоступен");
  }
}

export const GET = withApiErrors("app/api/admin/search/route.ts:GET", GETHandler);
