import { NextRequest, NextResponse } from "next/server";
import { apiFailure, withApiErrors } from "@/lib/api-route";
import { requireLocalControl } from "@/lib/local-admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { inspectSchemaHealth } from "@/lib/schema-health";

export const runtime = "nodejs";

async function GETHandler(request: NextRequest) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const daysRaw = Number(request.nextUrl.searchParams.get("days") || 30);
  const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(90, Math.floor(daysRaw))) : 30;
  const supabase = getSupabaseAdmin();

  try {
    const [snapshot, runtimeConfig, schemaHealth, errors, syncRuns, broadcasts] = await Promise.all([
      supabase.rpc("control_dashboard_snapshot_v210", { p_days: days }),
      getRuntimeConfig(),
      inspectSchemaHealth(supabase),
      supabase.from("app_error_inbox_v056").select("route,error_name,message,count,affected_users,last_seen_at").order("last_seen_at", { ascending: false }).limit(6),
      supabase.from("gift_sync_runs").select("id,status,pages_fetched,unique_received,unique_imported,assets_updated,virtual_created,skipped_invalid,error_message,started_at,finished_at").order("started_at", { ascending: false }).limit(6),
      supabase.from("control_broadcasts_v210").select("id,audience,segment,status,total_recipients,sent_count,failed_count,skipped_count,last_error,created_at,finished_at").order("created_at", { ascending: false }).limit(6),
    ]);

    if (snapshot.error) throw snapshot.error;
    return NextResponse.json({
      snapshot: snapshot.data,
      runtimeConfig,
      schemaHealth,
      latestErrors: errors.error ? [] : errors.data || [],
      recentGiftSyncs: syncRuns.error ? [] : syncRuns.data || [],
      recentBroadcasts: broadcasts.error ? [] : broadcasts.data || [],
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error, "Не удалось загрузить быстрый снимок Control Center");
  }
}

export const GET = withApiErrors("app/api/control/dashboard/route.ts:GET", GETHandler);
