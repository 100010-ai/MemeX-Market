import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";

const preferenceKeys = ["gift_sold", "gift_offer", "offer_resolved", "price_alert", "coin_move", "sponsored_task", "referral_reward", "promo", "telegram_push"] as const;

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  await supabase.from("notification_preferences").upsert({ profile_id: profile.id }, { onConflict: "profile_id", ignoreDuplicates: true });
  const [notifications, preferences, unread] = await Promise.all([
    supabase.from("user_notifications").select("id,kind,title,body,href,metadata,read_at,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(80),
    supabase.from("notification_preferences").select(preferenceKeys.join(",")).eq("profile_id", profile.id).single(),
    supabase.from("user_notifications").select("id", { count: "exact", head: true }).eq("profile_id", profile.id).is("read_at", null),
  ]);
  const error = notifications.error || preferences.error || unread.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    notifications: (notifications.data || []).map((row) => ({ id: String(row.id), kind: row.kind, title: row.title, body: row.body, href: row.href || null, metadata: row.metadata || {}, readAt: row.read_at || null, createdAt: row.created_at })),
    preferences: preferences.data,
    unreadCount: Number(unread.count || 0),
  });
}

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "notifications", String(profile.id), 80, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const supabase = getSupabaseAdmin();
  if (action === "read_all") {
    const { error } = await supabase.from("user_notifications").update({ read_at: new Date().toISOString() }).eq("profile_id", profile.id).is("read_at", null);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  if (action === "read") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID уведомления" }, { status: 400 });
    const { error } = await supabase.from("user_notifications").update({ read_at: new Date().toISOString() }).eq("profile_id", profile.id).eq("id", id);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  if (action === "preferences") {
    const update: Record<string, unknown> = { profile_id: profile.id, updated_at: new Date().toISOString() };
    for (const key of preferenceKeys) if (typeof body[key] === "boolean") update[key] = body[key];
    const { error } = await supabase.from("notification_preferences").upsert(update, { onConflict: "profile_id" });
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
