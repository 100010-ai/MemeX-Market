import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const LIST_LIMITS = {
  profiles: 750,
  missions: 500,
  coins: 750,
  gifts: 1_000,
  audit: 500,
  catalogSources: 100,
  promoCodes: 500,
  refundReconciliation: 100,
} as const;

function missingOptionalTable(error: { code?: string; message?: string } | null | undefined, names: string[]) {
  return Boolean(error && (error.code === "42P01" || names.some((name) => new RegExp(`${name}|schema cache`, "i").test(error.message || ""))));
}

function objectMetrics(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function relationRecord(value: unknown): Record<string, unknown> {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
}

async function GETHandler() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  const supabase = getSupabaseAdmin();
  try {
    const [profiles, missions, coins, gifts, audit, catalogSources, npcState, npcLog, promoCodes, refundReconciliation] = await Promise.all([
      supabase.from("profiles")
        .select("id,telegram_id,username,first_name,balance,xp,is_banned,ban_reason,banned_until,hidden_from_leaderboard,is_system,created_at")
        .order("created_at", { ascending: false }).limit(LIST_LIMITS.profiles),
      supabase.from("missions")
        .select("id,key,period,title,description,reward,target,action_type,sort_order,active,updated_at")
        .order("period").order("sort_order").limit(LIST_LIMITS.missions),
      supabase.from("coins")
        .select("id,creator_profile_id,name,symbol,description,image_url,current_price,market_cap,status,hidden_from_market,created_at")
        .order("created_at", { ascending: false }).limit(LIST_LIMITS.coins),
      supabase.from("gift_market_overview")
        .select("virtual_gift_id,asset_id,telegram_name,base_name,gift_number,owner_profile_id,owner_name,status,listing_price,estimated_value,is_burned,created_at,catalog_source,source_reference")
        .order("created_at", { ascending: false }).limit(LIST_LIMITS.gifts),
      supabase.from("admin_audit_log")
        .select("id,actor,action,target_type,target_id,payload,created_at")
        .order("created_at", { ascending: false }).limit(LIST_LIMITS.audit),
      supabase.from("gift_catalog_sources")
        .select("id,telegram_id,label,active,last_synced_at,last_error,created_at,updated_at")
        .order("created_at", { ascending: true }).limit(LIST_LIMITS.catalogSources),
      supabase.from("npc_market_state")
        .select("key,locked_until,last_tick_at,last_success_at,last_error,cycle,updated_at")
        .limit(1),
      supabase.from("npc_market_log")
        .select("id,virtual_gift_id,asset_id,npc_profile_id,fair_price,listing_price,pricing_mode,rarity_score,created_at")
        .order("created_at", { ascending: false }).limit(60),
      supabase.from("promo_codes")
        .select("id,code,reward,max_uses,uses_count,active,starts_at,ends_at,note,created_by,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(LIST_LIMITS.promoCodes),
      supabase.from("star_purchases")
        .select("id,profile_id,product_sku,stars,telegram_payment_charge_id,refunded_at,refund_reason,profiles!star_purchases_profile_id_fkey(telegram_id,username,first_name),store_products!star_purchases_product_sku_fkey(title,reward_label)")
        .eq("status", "refunded")
        .filter("refund_metadata->>virtualReversal", "eq", "manual_review_required")
        .order("refunded_at", { ascending: true })
        .limit(LIST_LIMITS.refundReconciliation),
    ]);

    const primaryError = profiles.error || missions.error || coins.error || gifts.error || audit.error || catalogSources.error || npcState.error || npcLog.error || refundReconciliation.error;
    if (primaryError) throw primaryError;
    if (promoCodes.error && !missingOptionalTable(promoCodes.error, ["promo_codes"])) throw promoCodes.error;

    const [dashboard, tonapiCount, tonapiVerified, tonapiState, activeSourceCount, economy] = await Promise.all([
      supabase.rpc("admin_dashboard_metrics_v028"),
      supabase.from("gift_assets").select("id", { head: true, count: "exact" }).eq("catalog_source", "tonapi"),
      supabase.from("gift_assets").select("id", { head: true, count: "exact" }).eq("catalog_source", "tonapi").eq("chain_verified", true),
      supabase.from("tonapi_catalog_state").select("last_discovery_at,last_sync_at,last_error,lock_until,updated_at").eq("singleton", true).maybeSingle(),
      supabase.from("gift_catalog_sources").select("id", { head: true, count: "exact" }).eq("active", true),
      supabase.from("economy_settings")
        .select("coin_launch_fee,coin_launch_cooldown_hours,coin_max_active,gift_fee_bps,updated_at")
        .eq("singleton", true).maybeSingle(),
    ]);
    const aggregateError = dashboard.error || tonapiCount.error || tonapiVerified.error || tonapiState.error || activeSourceCount.error || economy.error;
    if (aggregateError) throw aggregateError;

    const metrics = {
      ...objectMetrics(dashboard.data),
      catalogSources: activeSourceCount.count || 0,
      tonapiAssets: tonapiCount.count || 0,
      tonapiVerified: tonapiVerified.count || 0,
    };

    return NextResponse.json({
      metrics,
      economy: economy.data || null,
      profiles: profiles.data || [],
      missions: missions.data || [],
      coins: coins.data || [],
      gifts: gifts.data || [],
      audit: audit.data || [],
      catalogSources: catalogSources.data || [],
      npcState: npcState.data?.[0] || null,
      npcLog: npcLog.data || [],
      tonapiState: tonapiState.data || null,
      promoCodes: promoCodes.data || [],
      refundReconciliation: (refundReconciliation.data || []).map((row) => {
        const profile = relationRecord(row.profiles);
        const product = relationRecord(row.store_products);
        return {
          purchaseId: row.id,
          profileId: row.profile_id,
          profileName: profile.username ? `@${String(profile.username)}` : String(profile.first_name || "Профиль"),
          profileTelegramId: Number(profile.telegram_id || 0),
          productSku: row.product_sku || null,
          productTitle: product.title || product.reward_label || row.product_sku || "Legacy Stars reward",
          stars: Number(row.stars || 0),
          telegramPaymentChargeId: row.telegram_payment_charge_id || null,
          refundedAt: row.refunded_at,
          reason: row.refund_reason || "Причина не записана",
        };
      }),
      listLimits: LIST_LIMITS,
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("admin overview", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить админ-панель" }, { status: 500 });
  }
}
export const GET = withApiErrors("app/api/admin/overview/route.ts:GET", GETHandler);
