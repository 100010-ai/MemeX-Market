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
  const metadataRaw = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  return {
    label,
    kind,
    amount: Math.max(0, finiteNumber(row.amount)),
    metadata: {
      assetKey: text(metadataRaw.assetKey, text(metadataRaw.itemKey, "", 80), 80),
      rarity: text(metadataRaw.rarity, "", 32),
      exclusive: Boolean(metadataRaw.exclusive),
    },
  };
}

function frameKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, "", 80)).filter(Boolean).slice(0, 6);
}

function nextSeasonSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id, "", 80);
  if (!id) return null;
  return {
    id,
    title: text(row.title, "Следующая неделя", 160),
    startsAt: safeIsoDate(row.startsAt),
    weekNumber: Math.max(1, Math.floor(finiteNumber(row.weekNumber, 1))),
    theme: text(row.theme, "vault", 48),
    exclusiveFrameKeys: frameKeys(row.exclusiveFrameKeys),
  };
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
  const prestigeRaw = root.prestige && typeof root.prestige === "object" && !Array.isArray(root.prestige) ? root.prestige as Record<string, unknown> : {};
  const nextReward = rewardSnapshot(prestigeRaw.nextReward);
  return {
    season: {
      id: seasonId,
      title: text(seasonRaw.title, "Сезон MEMEX", 160),
      startsAt: safeIsoDate(seasonRaw.startsAt),
      endsAt: safeIsoDate(seasonRaw.endsAt),
      daysLeft: Math.max(0, Math.floor(finiteNumber(seasonRaw.daysLeft))),
      weekNumber: Math.max(1, Math.floor(finiteNumber(seasonRaw.weekNumber, 1))),
      theme: text(seasonRaw.theme, "vault", 48),
      exclusiveFrameKeys: frameKeys(seasonRaw.exclusiveFrameKeys),
    },
    xp: Math.max(0, Math.floor(finiteNumber(root.xp))),
    level: Math.max(1, Math.floor(finiteNumber(root.level, 1))),
    premium: Boolean(root.premium),
    levels,
    prestige: {
      unlocked: Boolean(prestigeRaw.unlocked),
      level: Math.max(0, Math.floor(finiteNumber(prestigeRaw.level))),
      claimed: Math.max(0, Math.floor(finiteNumber(prestigeRaw.claimed))),
      claimable: Math.max(0, Math.floor(finiteNumber(prestigeRaw.claimable))),
      stepXp: Math.max(1, Math.floor(finiteNumber(prestigeRaw.stepXp, 300))),
      baseXp: Math.max(0, Math.floor(finiteNumber(prestigeRaw.baseXp))),
      nextRequiredXp: Math.max(0, Math.floor(finiteNumber(prestigeRaw.nextRequiredXp))),
      nextClaimLevel: Math.max(1, Math.floor(finiteNumber(prestigeRaw.nextClaimLevel, 1))),
      nextReward,
    },
    nextSeason: nextSeasonSnapshot(root.nextSeason),
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
  const action = body.action == null
    ? "claim"
    : body.action === "claim" || body.action === "claim_all" || body.action === "claim_prestige"
      ? body.action
      : null;
  if (!action) return NextResponse.json({ error: "Некорректное действие с сезонной наградой" }, { status: 400 });

  if (action === "claim_all") {
    const { data, error } = await getSupabaseAdmin().rpc("claim_all_season_rewards_v300", { p_profile_id: profile.id });
    if (error) return apiFailure(error, "Не удалось забрать сезонные награды", 400);
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  }
  if (action === "claim_prestige") {
    const prestigeLevel = Number(body.prestigeLevel);
    if (!Number.isInteger(prestigeLevel) || prestigeLevel < 1 || prestigeLevel > 1000) return NextResponse.json({ error: "Некорректный Prestige-уровень" }, { status: 400 });
    const { data, error } = await getSupabaseAdmin().rpc("claim_season_prestige_v064", { p_profile_id: profile.id, p_prestige_level: prestigeLevel });
    if (error) {
      const locked = /locked|previous/i.test(error.message || "");
      if (!locked) return apiFailure(error, "Не удалось получить Prestige-награду", 400);
      return NextResponse.json({ error: /previous/i.test(error.message || "") ? "Сначала заберите предыдущую Prestige-награду" : "Нужно больше сезонного XP" }, { status: 409 });
    }
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  }
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
