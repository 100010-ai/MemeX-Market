import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function missing(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42883" || /season_snapshot_v200|claim_season_reward_v200|schema cache|could not find the function/i.test(error.message || "")));
}

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("season_snapshot_v200", { p_profile_id: profile.id });
  if (error) return NextResponse.json({ error: missing(error) ? "Примените миграцию экономики Market 2.0" : "Не удалось загрузить сезон" }, { status: missing(error) ? 503 : 500 });
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "season-claim", String(profile.id), 30, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const level = Number(body.level);
  const track = body.track === "premium" ? "premium" : body.track === "free" ? "free" : "";
  if (!Number.isInteger(level) || level < 1 || level > 100 || !track) return NextResponse.json({ error: "Некорректная награда" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("claim_season_reward_v200", { p_profile_id: profile.id, p_level: level, p_track: track });
  if (error) {
    console.error("season claim", error);
    const locked = /locked|required|premium/i.test(error.message || "");
    const absent = /not found|no active season/i.test(error.message || "");
    return NextResponse.json({ error: missing(error) ? "Примените миграцию экономики Market 2.0" : locked ? "Награда пока закрыта" : absent ? "Сезонная награда не найдена" : "Не удалось получить награду" }, { status: missing(error) ? 503 : locked ? 409 : absent ? 404 : 400 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
