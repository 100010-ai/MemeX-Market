import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { normalizeNotificationHref, normalizeNotificationPreferences, notificationPreferenceKeys } from "@/lib/notifications";

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  // Reading notifications must stay read-only. Preferences are backfilled by
  // the production migration; if a just-created profile has no row yet, the
  // same defaults are returned without an unnecessary write transaction.
  const [notifications, preferences] = await Promise.all([
    supabase.from("user_notifications").select("id,kind,title,body,href,metadata,read_at,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(80),
    supabase.from("notification_preferences").select(notificationPreferenceKeys.join(",")).eq("profile_id", profile.id).maybeSingle(),
  ]);
  const error = notifications.error || preferences.error;
  if (error) return apiFailure(error, "Не удалось выполнить запрос");
  const seen = new Map<string, number>();
  const normalized = (notifications.data || []).map((row) => ({
    id: String(row.id), kind: String(row.kind || "system"), title: String(row.title || ""), body: String(row.body || ""),
    href: normalizeNotificationHref(row.href), metadata: row.metadata || {}, readAt: row.read_at || null, createdAt: String(row.created_at || ""),
  })).filter((row) => {
    const signature = `${row.kind}:${row.title.trim().toLowerCase()}:${row.body.trim().toLowerCase()}:${row.href || ""}`;
    const createdAt = Date.parse(row.createdAt);
    const previous = seen.get(signature);
    if (Number.isFinite(createdAt)) seen.set(signature, createdAt);
    return previous == null || !Number.isFinite(createdAt) || Math.abs(previous - createdAt) > 5 * 60_000;
  });
  return NextResponse.json({
    notifications: normalized,
    preferences: normalizeNotificationPreferences(preferences.data),
    unreadCount: normalized.reduce((count, row) => count + (row.readAt ? 0 : 1), 0),
  }, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "notifications", String(profile.id), 80, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = typeof body.action === "string" ? body.action : "";
  const supabase = getSupabaseAdmin();
  if (action === "read_all") {
    const { error } = await supabase.from("user_notifications").update({ read_at: new Date().toISOString() }).eq("profile_id", profile.id).is("read_at", null);
    if (error) return apiFailure(error, "Не удалось обновить уведомления");
    return NextResponse.json({ ok: true });
  }
  if (action === "read") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID уведомления" }, { status: 400 });
    const result = await supabase.from("user_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("profile_id", profile.id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (result.error) return apiFailure(result.error, "Не удалось обновить уведомления");
    if (!result.data) return NextResponse.json({ error: "Уведомление не найдено" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  if (action === "preferences") {
    const update: Record<string, unknown> = { profile_id: profile.id, updated_at: new Date().toISOString() };
    let changed = false;
    for (const key of notificationPreferenceKeys) {
      if (!(key in body)) continue;
      if (typeof body[key] !== "boolean") {
        return NextResponse.json({ error: "Некорректное значение настройки уведомлений", key }, { status: 400 });
      }
      update[key] = body[key];
      changed = true;
    }
    if (!changed) return NextResponse.json({ error: "Нет настроек для обновления" }, { status: 400 });
    const { error } = await supabase.from("notification_preferences").upsert(update, { onConflict: "profile_id" });
    if (error) return apiFailure(error, "Не удалось обновить уведомления");
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
export const GET = withApiErrors("app/api/notifications/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/notifications/route.ts:POST", POSTHandler);
