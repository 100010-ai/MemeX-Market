import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";


async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("season_snapshot_v200", { p_profile_id: profile.id });
  if (error) return apiFailure(error, "Не удалось загрузить сезон");
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "season-claim", String(profile.id), 30, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const level = Number(body.level);
  const track = body.track === "premium" ? "premium" : body.track === "free" ? "free" : "";
  if (!Number.isInteger(level) || level < 1 || level > 100 || !track) return NextResponse.json({ error: "Некорректная награда" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("claim_season_reward_v200", { p_profile_id: profile.id, p_level: level, p_track: track });
  if (error) {
    console.error("season claim", error);
    const locked = /locked|required|premium/i.test(error.message || "");
    const absent = /not found|no active season/i.test(error.message || "");
    if (!locked && !absent) return apiFailure(error, "Не удалось получить награду", 400);
    return NextResponse.json({ error: locked ? "Награда пока закрыта" : "Сезонная награда не найдена" }, { status: locked ? 409 : 404 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
export const GET = withApiErrors("app/api/season/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/season/route.ts:POST", POSTHandler);
