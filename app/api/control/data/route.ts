import { NextRequest, NextResponse } from "next/server";
import { apiFailure, withApiErrors } from "@/lib/api-route";
import { requireLocalControl } from "@/lib/local-admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const sections = new Set(["players", "coins", "gifts", "missions", "audit", "stars", "catalog", "broadcasts"]);
function safeSearch(value: string) { return value.replace(/[%_,()]/g, "").slice(0, 80); }

async function GETHandler(request: NextRequest) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const section = String(request.nextUrl.searchParams.get("section") || "");
  if (!sections.has(section)) return NextResponse.json({ error: "Неизвестный раздел" }, { status: 400 });
  const limit = Math.max(20, Math.min(100, Number(request.nextUrl.searchParams.get("limit") || 60) || 60));
  const offset = Math.max(0, Math.min(10_000, Number(request.nextUrl.searchParams.get("offset") || 0) || 0));
  const q = safeSearch(String(request.nextUrl.searchParams.get("q") || "").trim());
  const supabase = getSupabaseAdmin();

  try {
    let query: any;
    if (section === "players") {
      query = supabase
        .from("profiles")
        .select("id,telegram_id,username,first_name,last_name,balance,xp,mxm_coins,energy,max_energy,is_banned,ban_reason,banned_until,hidden_from_leaderboard,premium_until,stars_spent,vip_points,last_gift_sync_at,created_at,updated_at", { count: "exact" })
        .eq("is_system", false)
        .order("created_at", { ascending: false });
      if (q) {
        if (/^\d{4,20}$/.test(q)) query = query.eq("telegram_id", Number(q));
        else query = query.or(`username.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
      }
    } else if (section === "coins") {
      query = supabase
        .from("coins")
        .select("id,creator_profile_id,name,symbol,description,image_url,current_price,market_cap,total_supply,token_reserve,quote_reserve,status,hidden_from_market,launch_price,graduated_at,created_at,updated_at", { count: "exact" })
        .order("created_at", { ascending: false });
      if (q) query = query.or(`name.ilike.%${q}%,symbol.ilike.%${q}%`);
    } else if (section === "gifts") {
      query = supabase
        .from("gift_market_overview")
        .select("virtual_gift_id,asset_id,telegram_name,base_name,gift_number,model_name,model_rarity,symbol_name,backdrop_name,owner_profile_id,owner_name,status,listing_price,last_sale_price,estimated_value,is_burned,created_at,catalog_source,source_reference,chain_verified", { count: "exact" })
        .order("created_at", { ascending: false });
      if (q) query = query.or(`base_name.ilike.%${q}%,owner_name.ilike.%${q}%,telegram_name.ilike.%${q}%`);
    } else if (section === "missions") {
      query = supabase
        .from("missions")
        .select("id,key,period,title,description,reward,target,action_type,sort_order,active,updated_at", { count: "exact" })
        .order("period")
        .order("sort_order");
      if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,key.ilike.%${q}%`);
    } else if (section === "audit") {
      query = supabase
        .from("admin_audit_log")
        .select("id,actor,action,target_type,target_id,payload,created_at", { count: "exact" })
        .order("created_at", { ascending: false });
      if (q) query = query.or(`action.ilike.%${q}%,actor.ilike.%${q}%,target_type.ilike.%${q}%`);
    } else if (section === "stars") {
      query = supabase
        .from("star_purchases")
        .select("id,profile_id,payer_telegram_id,stars,ton_reward,status,product_sku,telegram_payment_charge_id,paid_at,refunded_at,refund_reason,expires_at,created_at,updated_at", { count: "exact" })
        .order("created_at", { ascending: false });
      if (q && /^\d{4,20}$/.test(q)) query = query.eq("payer_telegram_id", Number(q));
    } else if (section === "catalog") {
      query = supabase
        .from("tonapi_gift_collections")
        .select("address,name,description,total_hint,next_offset,active,verified_at,last_synced_at,last_error,created_at,updated_at", { count: "exact" })
        .order("updated_at", { ascending: false });
      if (q) query = query.or(`name.ilike.%${q}%,address.ilike.%${q}%`);
    } else {
      query = supabase
        .from("control_broadcasts_v210")
        .select("id,actor_telegram_id,audience,segment,channel_target,message,parse_mode,attachment_type,attachment_url,buttons,link_preview,status,total_recipients,sent_count,failed_count,skipped_count,last_error,started_at,finished_at,created_at,updated_at", { count: "exact" })
        .order("created_at", { ascending: false });
    }

    const result = await query.range(offset, offset + limit - 1);
    if (result.error) throw result.error;
    return NextResponse.json({
      section,
      rows: result.data || [],
      total: Number(result.count || 0),
      offset,
      limit,
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error, `Не удалось загрузить раздел ${section}`);
  }
}

export const GET = withApiErrors("app/api/control/data/route.ts:GET", GETHandler);
