import { NextResponse } from "next/server";
import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { requireLocalControl } from "@/lib/local-admin";
import { sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig, invalidateRuntimeConfigCache, validateRuntimeConfigInput } from "@/lib/runtime-config";
import { inspectSchemaHealth } from "@/lib/schema-health";

export const runtime = "nodejs";
const ACTOR = "local-control-center";

async function audit(action: string, payload: Record<string, unknown> = {}) {
  const { error } = await getSupabaseAdmin().from("admin_audit_log").insert({
    actor: ACTOR,
    action,
    target_type: "system",
    payload,
  });
  if (error) console.error("control ops audit", error);
}

async function count(table: string, apply?: (query: any) => any) {
  let query: any = getSupabaseAdmin().from(table).select("*", { count: "exact", head: true });
  if (apply) query = apply(query);
  const result = await query;
  if (result.error) return null;
  return Number(result.count || 0);
}

async function GETHandler(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const supabase = getSupabaseAdmin();
    const [runtimeConfig, schemaHealth, pendingStars, paidStars, refundedStars, recentErrors, openOrders] = await Promise.all([
      getRuntimeConfig(),
      inspectSchemaHealth(supabase),
      count("star_purchases", (q) => q.eq("status", "pending")),
      count("star_purchases", (q) => q.eq("status", "paid")),
      count("star_purchases", (q) => q.eq("status", "refunded")),
      count("app_error_inbox_v056", (q) => q.gte("last_seen_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())),
      count("coin_conditional_orders_v056", (q) => q.eq("status", "open")),
    ]);

    const latestErrors = await supabase
      .from("app_error_inbox_v056")
      .select("route,error_name,message,count,affected_users,last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(8);

    return NextResponse.json({
      runtimeConfig,
      schemaHealth,
      ops: { pendingStars, paidStars, refundedStars, recentErrors, openOrders },
      latestErrors: latestErrors.error ? [] : latestErrors.data || [],
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error, "Не удалось загрузить состояние Control Center");
  }
}

async function POSTHandler(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = typeof body.action === "string" ? body.action : "";
  const supabase = getSupabaseAdmin();

  try {
    if (action === "runtime.update") {
      const input = validateRuntimeConfigInput(body.config);
      const updatedAt = new Date().toISOString();
      const { error } = await supabase.from("runtime_config_v056").update({
        maintenance_mode: input.maintenanceMode,
        maintenance_message: input.maintenanceMessage,
        feature_flags: input.featureFlags,
        remote_config: input.remoteConfig,
        updated_at: updatedAt,
      }).eq("singleton", true);
      if (error) throw error;
      invalidateRuntimeConfigCache();
      await audit("runtime_config.update", input);
      return NextResponse.json({ ok: true, config: { ...input, updatedAt } });
    }

    if (action === "stars.release_expired") {
      const { data, error } = await supabase.rpc("release_expired_star_authorizations_v200", { p_limit: 250 });
      if (error) throw error;
      await audit("stars.release_expired", { result: data });
      return NextResponse.json({ ok: true, result: data });
    }

    return NextResponse.json({ error: "Неизвестная системная операция" }, { status: 400 });
  } catch (error) {
    return apiFailure(error, "Системная операция не выполнена", 400);
  }
}

export const GET = withApiErrors("app/api/control/ops/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/control/ops/route.ts:POST", POSTHandler);
