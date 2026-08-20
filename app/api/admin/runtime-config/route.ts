import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig, validateRuntimeConfigInput } from "@/lib/runtime-config";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export async function GET() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  try {
    return NextResponse.json({ config: await getRuntimeConfig() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("admin runtime config", error);
    return NextResponse.json({ error: "Не удалось загрузить Runtime Config" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-runtime-config", String(admin.id), 12, 60))) {
    return NextResponse.json({ error: "Слишком много изменений Runtime Config." }, { status: 429 });
  }
  try {
    const input = validateRuntimeConfigInput(await request.json());
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("runtime_config_v056").update({
      maintenance_mode: input.maintenanceMode,
      maintenance_message: input.maintenanceMessage,
      feature_flags: input.featureFlags,
      remote_config: input.remoteConfig,
      updated_at: new Date().toISOString(),
    }).eq("singleton", true);
    if (error) throw error;
    await supabase.from("admin_audit_log").insert({
      actor: `admin:${admin.telegram_id}`,
      action: "runtime_config.update",
      target_type: "runtime_config",
      payload: input,
    });
    return NextResponse.json({ config: await getRuntimeConfig() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить Runtime Config" }, { status: 400 });
  }
}
