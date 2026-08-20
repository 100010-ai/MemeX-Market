import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function missing(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (["42883", "42703", "PGRST204"].includes(String(error.code || "")) || /monetization_snapshot_v200|equip_profile_item_v200|equipped_profile_frame|schema cache|could not find the function/i.test(error.message || "")));
}

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("monetization_snapshot_v200", { p_profile_id: profile.id });
  if (error) return NextResponse.json({ error: missing(error) ? "Примените миграцию экономики Market 2.0" : "Не удалось загрузить предметы профиля" }, { status: missing(error) ? 503 : 500 });
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  return NextResponse.json({ wallet: payload.wallet || {}, items: Array.isArray(payload.profileItems) ? payload.profileItems : [] }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "profile-cosmetic", String(profile.id), 20, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  if (body.action === "reset" && body.key == null) {
    const reset = await getSupabaseAdmin().from("profiles").update({ equipped_profile_frame: null, updated_at: new Date().toISOString() }).eq("id", profile.id).select("equipped_profile_frame").single();
    if (reset.error) return NextResponse.json({ error: missing(reset.error) ? "Примените миграцию экономики Market 2.0" : "Не удалось снять рамку" }, { status: missing(reset.error) ? 503 : 500 });
    return NextResponse.json({ status: "unequipped", key: null }, { headers: { "cache-control": "no-store" } });
  }
  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  if (!/^[a-z0-9:_-]{3,80}$/.test(key)) return NextResponse.json({ error: "Некорректный предмет" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("equip_profile_item_v200", { p_profile_id: profile.id, p_item_key: key });
  if (error) {
    console.error("profile cosmetic", error);
    const notOwned = /not owned/i.test(error.message || "");
    const wrongType = /only profile frames|only.*frame/i.test(error.message || "");
    return NextResponse.json({ error: missing(error) ? "Примените миграцию экономики Market 2.0" : notOwned ? "Предмет не принадлежит профилю" : wrongType ? "Можно выбрать только рамку профиля" : "Не удалось применить оформление" }, { status: missing(error) ? 503 : notOwned ? 403 : wrongType ? 409 : 400 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
