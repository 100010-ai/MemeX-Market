import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rewardedAdsConfig } from "@/lib/rewarded-ads";

function status(ok: boolean, detail: string, latencyMs?: number) {
  return { status: ok ? "ok" as const : "warning" as const, detail, latencyMs: latencyMs ?? null };
}

export async function GET() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = getSupabaseAdmin();
  const started = Date.now();
  const dbResult = await supabase.from("runtime_config_v056").select("updated_at").eq("singleton", true).maybeSingle();
  const dbLatency = Date.now() - started;
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [syncResult, errorCountResult, activeOrderResult] = await Promise.all([
    supabase.from("gift_sync_runs").select("status,started_at,finished_at,error_message").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("app_error_inbox_v056").select("id", { count: "exact", head: true }).gte("last_seen_at", since24h),
    supabase.from("coin_conditional_orders_v056").select("id", { count: "exact", head: true }).in("status", ["active", "executing"]),
  ]);

  const ads = rewardedAdsConfig();
  const latestSync = syncResult.data as { status?: string; started_at?: string; finished_at?: string | null; error_message?: string | null } | null;
  const latestSyncAgeMinutes = latestSync?.started_at ? Math.max(0, Math.round((Date.now() - new Date(latestSync.started_at).getTime()) / 60000)) : null;
  const recentErrors = Number(errorCountResult.count || 0);

  const services = {
    supabase: dbResult.error ? status(false, "База данных не ответила") : status(true, "Postgres/API доступны", dbLatency),
    telegramBot: status(Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()), process.env.TELEGRAM_BOT_TOKEN?.trim() ? "Bot API настроен" : "TELEGRAM_BOT_TOKEN не задан"),
    telegramWebhook: status(Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim()), process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ? "Webhook secret настроен" : "TELEGRAM_WEBHOOK_SECRET не задан"),
    tonApi: status(Boolean(process.env.TONAPI_KEY?.trim()), process.env.TONAPI_KEY?.trim() ? "Authenticated TonAPI включён" : "TONAPI_KEY не задан"),
    adsGram: status(Boolean(ads.configured && ads.blockId && !ads.configurationError), ads.configurationError || (ads.configured && ads.blockId ? "Reward block + server verification настроены" : "AdsGram настроен не полностью")),
    cron: status(Boolean(process.env.CRON_SECRET?.trim()), process.env.CRON_SECRET?.trim() ? "CRON_SECRET настроен" : "CRON_SECRET не задан"),
    giftSync: status(Boolean(latestSync && latestSync.status !== "failed"), latestSync ? `${latestSync.status}${latestSyncAgeMinutes == null ? "" : ` · ${latestSyncAgeMinutes} мин. назад`}${latestSync.error_message ? ` · ${latestSync.error_message.slice(0, 100)}` : ""}` : "Синхронизаций ещё нет"),
  };

  const degraded = Object.values(services).filter((item) => item.status !== "ok").length;
  const health = dbResult.error ? "critical" : degraded > 0 || recentErrors > 20 ? "degraded" : "healthy";

  return NextResponse.json({
    health,
    services,
    counters: {
      recentErrors24h: recentErrors,
      activeConditionalOrders: Number(activeOrderResult.count || 0),
      latestGiftSyncAt: latestSync?.started_at || null,
    },
    checkedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "private, no-store" } });
}
