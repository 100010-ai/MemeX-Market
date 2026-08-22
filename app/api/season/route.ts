import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, safeIsoDate, text } from "@/lib/safe-data";


function rewardSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const label = text(row.label, "", 160);
  const kind = text(row.kind, "", 64);
  if (!label || !kind) return null;
  return { label, kind, amount: Math.max(0, finiteNumber(row.amount)) };
}

function seasonSnapshot(value: unknown) {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const seasonRaw = root.season && typeof root.season === "object" && !Array.isArray(root.season) ? root.season as Record<string, unknown> : {};
  const seasonId = text(seasonRaw.id, "", 80);
  if (!seasonId) return null;
  const levels = Array.isArray(root.levels) ? root.levels.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const level = Math.floor(finiteNumber(row.level));
    if (level < 1 || level > 100) return [];
    return [{
      level,
      requiredXp: Math.max(0, Math.floor(finiteNumber(row.requiredXp))),
      freeReward: rewardSnapshot(row.freeReward),
      premiumReward: rewardSnapshot(row.premiumReward),
      freeClaimed: Boolean(row.freeClaimed),
      premiumClaimed: Boolean(row.premiumClaimed),
    }];
  }).sort((a, b) => a.level - b.level) : [];
  return {
    season: {
      id: seasonId,
      title: text(seasonRaw.title, "Сезон MEMEX", 160),
      startsAt: safeIsoDate(seasonRaw.startsAt),
      endsAt: safeIsoDate(seasonRaw.endsAt),
      daysLeft: Math.max(0, Math.floor(finiteNumber(seasonRaw.daysLeft))),
    },
    xp: Math.max(0, Math.floor(finiteNumber(root.xp))),
    level: Math.max(1, Math.floor(finiteNumber(root.level, 1))),
    premium: Boolean(root.premium),
    levels,
  };
}


async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("season_snapshot_v200", { p_profile_id: profile.id });
  if (error) return apiFailure(error, "Не удалось загрузить сезон");
  const snapshot = seasonSnapshot(data);
  if (!snapshot) return NextResponse.json({ error: "Сезонные данные повреждены", code: "DATA_INTEGRITY" }, { status: 500 });
  return NextResponse.json(snapshot, { headers: { "cache-control": "private, no-store" } });
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
