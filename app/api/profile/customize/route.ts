import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";


async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("monetization_snapshot_v200", { p_profile_id: profile.id });
  if (error) return apiFailure(error, "Не удалось загрузить предметы профиля");
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  return NextResponse.json({ wallet: payload.wallet || {}, items: Array.isArray(payload.profileItems) ? payload.profileItems : [] }, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "profile-cosmetic", String(profile.id), 20, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  if (body.action === "reset" && body.key == null) {
    const reset = await getSupabaseAdmin().from("profiles").update({ equipped_profile_frame: null, updated_at: new Date().toISOString() }).eq("id", profile.id).select("equipped_profile_frame").single();
    if (reset.error) return apiFailure(reset.error, "Не удалось снять рамку");
    return NextResponse.json({ status: "unequipped", key: null }, { headers: { "cache-control": "no-store" } });
  }
  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  if (!/^[a-z0-9:_-]{3,80}$/.test(key)) return NextResponse.json({ error: "Некорректный предмет" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("equip_profile_item_v200", { p_profile_id: profile.id, p_item_key: key });
  if (error) {
    console.error("profile cosmetic", error);
    const notOwned = /not owned/i.test(error.message || "");
    const wrongType = /only profile frames|only.*frame/i.test(error.message || "");
    if (!notOwned && !wrongType) return apiFailure(error, "Не удалось применить оформление", 400);
    return NextResponse.json({ error: notOwned ? "Предмет не принадлежит профилю" : "Можно выбрать только рамку профиля" }, { status: notOwned ? 403 : 409 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
export const GET = withApiErrors("app/api/profile/customize/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/profile/customize/route.ts:POST", POSTHandler);
