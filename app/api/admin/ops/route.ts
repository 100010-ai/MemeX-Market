import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { apiFailure, withApiErrors } from "@/lib/api-route";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function rows<T>(value: { data: T[] | null }) { return value.data || []; }
function count(value: { count: number | null }) { return value.count || 0; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

async function GETHandler() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const supabase = getSupabaseAdmin();
  const since24 = new Date(Date.now() - 86_400_000).toISOString();
  const since15m = new Date(Date.now() - 15 * 60_000).toISOString();

  try {
    const [
      runtime,
      users,
      newUsers,
      bannedUsers,
      activeCoins,
      hiddenCoins,
      listedGifts,
      activeMissions,
      products,
      cases,
      starsPaid,
      starsRefunded,
      reversalQueue,
      recentErrors,
      recentAudit,
      recentActivity,
      latestGiftSync,
      leagueSeason,
      weeklySeason,
      conditionalOrders,
      economyFlow,
      catalogHealth,
    ] = await Promise.all([
      getRuntimeConfig(),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_system", false),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_system", false).gte("created_at", since24),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_banned", true),
      supabase.from("coins").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("coins").select("id", { count: "exact", head: true }).eq("hidden_from_market", true),
      supabase.from("virtual_gifts").select("id", { count: "exact", head: true }).eq("status", "listed"),
      supabase.from("missions").select("id", { count: "exact", head: true }).eq("active", true),
      supabase.from("store_products").select("sku,title,category,stars_price,active,badge,updated_at").order("sort_order", { ascending: true }).limit(120),
      supabase.from("case_definitions").select("sku,title,tier,remaining_supply,active,rare_pity,epic_pity,legendary_pity").order("title", { ascending: true }).limit(120),
      supabase.from("star_purchases").select("id,stars,product_sku,profile_id,paid_at,status").eq("status", "paid").gte("paid_at", since24).order("paid_at", { ascending: false }).limit(2000),
      supabase.from("star_purchases").select("id,stars,product_sku,profile_id,refunded_at,status").eq("status", "refunded").gte("refunded_at", since24).order("refunded_at", { ascending: false }).limit(500),
      supabase.from("star_purchase_reversals_v074").select("purchase_id,profile_id,product_sku,status,details,created_at,processed_at").in("status", ["partial", "manual_review", "failed"]).order("created_at", { ascending: false }).limit(30),
      supabase.from("app_error_inbox_v056").select("id,route,error_name,message,count,affected_users,last_seen_at").gte("last_seen_at", since24).order("last_seen_at", { ascending: false }).limit(20),
      supabase.from("admin_audit_log").select("id,actor,action,target_type,target_id,payload,created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("activity_events_v074").select("id,kind,importance,amount,metadata,created_at,actor_profile_id,coin_id,virtual_gift_id").order("created_at", { ascending: false }).limit(20),
      supabase.from("gift_sync_runs").select("id,status,pages_fetched,unique_received,unique_imported,assets_updated,virtual_created,error_message,started_at,finished_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("league_seasons").select("id,season_key,title,starts_at,ends_at,status").eq("status", "active").order("starts_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("seasons").select("id,season_key,title,starts_at,ends_at,week_number").eq("active", true).order("starts_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("coin_conditional_orders_v056").select("id", { count: "exact", head: true }).in("status", ["active", "executing"]),
      supabase.rpc("economy_flow_snapshot_v074", { p_days: 7 }),
      supabase.rpc("store_catalog_health_v074"),
    ]);

    const firstError = [users,newUsers,bannedUsers,activeCoins,hiddenCoins,listedGifts,activeMissions,products,cases,starsPaid,starsRefunded,reversalQueue,recentErrors,recentAudit,recentActivity,latestGiftSync,leagueSeason,weeklySeason,conditionalOrders,economyFlow,catalogHealth].find((item) => item.error)?.error;
    if (firstError) throw firstError;

    const paidRows = rows(starsPaid);
    const refundRows = rows(starsRefunded);
    const errors = rows(recentErrors);
    const reversals = rows(reversalQueue);
    const storeRows = rows(products);
    const caseRows = rows(cases);
    const stars24h = paidRows.reduce((sum, row) => sum + number(row.stars), 0);
    const refundedStars24h = refundRows.reduce((sum, row) => sum + number(row.stars), 0);
    const errors15m = errors.filter((row) => new Date(String(row.last_seen_at)).getTime() >= new Date(since15m).getTime()).reduce((sum, row) => sum + number(row.count), 0);
    const lowStockCases = caseRows.filter((row) => row.active && row.remaining_supply != null && number(row.remaining_supply) <= 50);
    const latestSyncState = String(latestGiftSync.data?.status || "");
    const latestSyncStartedAt = latestGiftSync.data?.started_at ? Date.parse(String(latestGiftSync.data.started_at)) : Number.NaN;
    const latestSyncAgeMinutes = Number.isFinite(latestSyncStartedAt) ? Math.max(0, Math.round((Date.now() - latestSyncStartedAt) / 60_000)) : null;

    const alerts: Array<{ id: string; level: "info" | "warn" | "critical"; title: string; detail: string; href?: string }> = [];
    if (runtime.maintenanceMode) alerts.push({ id: "maintenance", level: "warn", title: "Maintenance включён", detail: runtime.maintenanceMessage });
    if (reversals.length) alerts.push({ id: "reversals", level: "critical", title: `Возвраты требуют внимания: ${reversals.length}`, detail: "Есть partial/manual_review/failed reversal операции." });
    if (errors15m >= 5) alerts.push({ id: "errors", level: "critical", title: `Всплеск ошибок: ${errors15m}`, detail: "Ошибки за последние 15 минут выше безопасного порога." });
    if (latestSyncState === "failed") {
      alerts.push({ id: "gift-sync", level: "warn", title: "Последний Gift Sync неуспешен", detail: String(latestGiftSync.data?.error_message || latestSyncState) });
    } else if (latestSyncState === "running" && latestSyncAgeMinutes != null && latestSyncAgeMinutes > 15) {
      alerts.push({ id: "gift-sync-stuck", level: "warn", title: "Gift Sync, вероятно, завис", detail: `Синхронизация остаётся running уже ${latestSyncAgeMinutes} мин.` });
    } else if (latestSyncState && !["success", "succeeded", "completed", "running"].includes(latestSyncState)) {
      alerts.push({ id: "gift-sync-state", level: "warn", title: "Необычное состояние Gift Sync", detail: latestSyncState });
    }
    if (lowStockCases.length) alerts.push({ id: "case-stock", level: "warn", title: `Заканчиваются кейсы: ${lowStockCases.length}`, detail: lowStockCases.slice(0, 4).map((item) => `${item.title}: ${item.remaining_supply}`).join(" · ") });
    if (!runtime.featureFlags.stars) alerts.push({ id: "stars-off", level: "info", title: "Stars отключены", detail: "Покупки за Telegram Stars сейчас недоступны." });
    if (!runtime.featureFlags.memecoins) alerts.push({ id: "coins-off", level: "info", title: "Мемкоины отключены", detail: "Рынок мемкоинов выключен feature flag." });

    return NextResponse.json({
      operator: { id: admin.id, telegramId: admin.telegram_id, username: admin.username, firstName: admin.first_name },
      release: {
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        url: process.env.VERCEL_URL || null,
        region: process.env.VERCEL_REGION || null,
      },
      runtime,
      metrics: {
        users: count(users), newUsers24h: count(newUsers), bannedUsers: count(bannedUsers),
        activeCoins: count(activeCoins), hiddenCoins: count(hiddenCoins), listedGifts: count(listedGifts),
        activeMissions: count(activeMissions), openConditionalOrders: count(conditionalOrders),
        stars24h, refundedStars24h, netStars24h: stars24h - refundedStars24h,
        activeProducts: storeRows.filter((row) => row.active).length,
        activeCases: caseRows.filter((row) => row.active).length,
        reversalQueue: reversals.length,
        recentErrorGroups: errors.length,
      },
      alerts,
      products: storeRows,
      cases: caseRows,
      reversals,
      errors,
      audit: rows(recentAudit),
      activity: rows(recentActivity),
      latestGiftSync: latestGiftSync.data || null,
      leagueSeason: leagueSeason.data || null,
      weeklySeason: weeklySeason.data || null,
      economy: economyFlow.data || null,
      catalogHealth: catalogHealth.data || null,
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("admin ops snapshot", error);
    return apiFailure(error, "Не удалось собрать MemeX Ops");
  }
}

export const GET = withApiErrors("app/api/admin/ops/route.ts:GET", GETHandler);
