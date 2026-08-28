import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { tonApiHealth } from "@/lib/providers/tonapi-client";

function status(ok: boolean, detail: string, latencyMs?: number) {
  return { status: ok ? "ok" as const : "warning" as const, detail, latencyMs: latencyMs ?? null };
}

function giftSyncStatus(
  latestSync: { status?: string; started_at?: string; finished_at?: string | null; error_message?: string | null } | null,
  queryFailed: boolean,
) {
  if (queryFailed) return status(false, "Не удалось проверить состояние Gift sync");
  if (!latestSync) return status(true, "Пользовательских синхронизаций Gifts ещё не было");

  const state = String(latestSync.status || "unknown");
  const startedAt = latestSync.started_at ? Date.parse(latestSync.started_at) : Number.NaN;
  const ageMinutes = Number.isFinite(startedAt) ? Math.max(0, Math.round((Date.now() - startedAt) / 60_000)) : null;
  const ageLabel = ageMinutes == null ? "" : ` · ${ageMinutes} мин. назад`;

  if (state === "failed") {
    const reason = latestSync.error_message ? ` · ${latestSync.error_message.slice(0, 100)}` : "";
    return status(false, `failed${ageLabel}${reason}`);
  }
  if (state === "running" && ageMinutes != null && ageMinutes > 15) {
    return status(false, `running${ageLabel} · синхронизация, вероятно, зависла`);
  }
  return status(true, `${state}${ageLabel}`);
}

async function GETHandler() {
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

  const latestSync = syncResult.data as { status?: string; started_at?: string; finished_at?: string | null; error_message?: string | null } | null;
  const recentErrors = Number(errorCountResult.count || 0);
  const diagnosticErrors = [syncResult.error, errorCountResult.error, activeOrderResult.error].filter(Boolean);
  if (diagnosticErrors.length) {
    console.warn("admin health diagnostics", diagnosticErrors.map((error) => ({ code: error?.code || null })));
  }

  const ton = tonApiHealth();
  const tonDetail = ton.circuitOpen
    ? `TonAPI circuit открыт, retry через ${Math.ceil(ton.circuitRetryInMs / 1000)} сек.`
    : ton.authenticatedConfigured
      ? "Authenticated TonAPI включён"
      : "TonAPI работает в публичном fallback-режиме";

  const services = {
    supabase: dbResult.error ? status(false, "База данных не ответила") : status(true, "Postgres/API доступны", dbLatency),
    telegramBot: status(Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()), process.env.TELEGRAM_BOT_TOKEN?.trim() ? "Bot API настроен" : "TELEGRAM_BOT_TOKEN не задан"),
    telegramWebhook: status(Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim()), process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ? "Webhook secret настроен" : "TELEGRAM_WEBHOOK_SECRET не задан"),
    tonApi: status(!ton.circuitOpen, tonDetail),
    cron: status(Boolean(process.env.CRON_SECRET?.trim()), process.env.CRON_SECRET?.trim() ? "CRON_SECRET настроен" : "CRON_SECRET не задан"),
    giftSync: giftSyncStatus(latestSync, Boolean(syncResult.error)),
  };

  const degraded = Object.values(services).filter((item) => item.status !== "ok").length;
  const health = dbResult.error ? "critical" : degraded > 0 || recentErrors > 20 || diagnosticErrors.length > 0 ? "degraded" : "healthy";

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
export const GET = withApiErrors("app/api/admin/health/route.ts:GET", GETHandler);
