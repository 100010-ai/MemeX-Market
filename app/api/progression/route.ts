import { apiFailure, errorMessage, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, safeIsoDate, text } from "@/lib/safe-data";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reward(value: unknown) {
  const row = object(value);
  const label = text(row.label, "Награда", 160);
  const kind = text(row.kind, "mxm_coins", 64);
  return { label, kind, amount: Math.max(0, Math.floor(finiteNumber(row.amount))), metadata: object(row.metadata) };
}

function progressionSnapshot(value: unknown) {
  const root = object(value);
  const accountRaw = object(root.account);
  const streakRaw = object(root.streak);
  const accountRewards = Array.isArray(accountRaw.rewards) ? accountRaw.rewards.flatMap((raw) => {
    const row = object(raw);
    const level = Math.floor(finiteNumber(row.level));
    if (level < 2 || level > 100) return [];
    return [{
      level,
      kind: text(row.kind, "mxm_coins", 64),
      label: text(row.label, "Награда", 160),
      amount: Math.max(0, Math.floor(finiteNumber(row.amount))),
      unlocked: Boolean(row.unlocked),
      claimed: Boolean(row.claimed),
    }];
  }) : [];
  const calendar = Array.isArray(streakRaw.calendar) ? streakRaw.calendar.flatMap((raw) => {
    const row = object(raw);
    const day = Math.floor(finiteNumber(row.day));
    if (day < 1 || day > 7) return [];
    return [{ day, ...reward(row) }];
  }) : [];
  const achievements = Array.isArray(root.achievements) ? root.achievements.flatMap((raw) => {
    const row = object(raw);
    const key = text(row.key, "", 100);
    if (!key) return [];
    const target = Math.max(1, finiteNumber(row.target, 1));
    return [{
      key,
      title: text(row.title, "Достижение", 140),
      description: text(row.description, "", 400),
      icon: text(row.icon, "award", 40),
      xpReward: Math.max(0, Math.floor(finiteNumber(row.xpReward))),
      category: text(row.category, "other", 40),
      rarity: text(row.rarity, "common", 32),
      progress: Math.max(0, Math.min(target, finiteNumber(row.progress))),
      target,
      unlocked: Boolean(row.unlocked),
      unlockedAt: row.unlockedAt ? safeIsoDate(row.unlockedAt) : null,
    }];
  }) : [];

  const nextRewardRaw = object(streakRaw.nextReward);
  return {
    account: {
      xp: Math.max(0, Math.floor(finiteNumber(accountRaw.xp))),
      level: Math.max(1, Math.min(100, Math.floor(finiteNumber(accountRaw.level, 1)))),
      levelProgress: Math.max(0, Math.min(1, finiteNumber(accountRaw.levelProgress))),
      levelStartXp: Math.max(0, Math.floor(finiteNumber(accountRaw.levelStartXp))),
      nextLevelXp: Math.max(0, Math.floor(finiteNumber(accountRaw.nextLevelXp))),
      xpForNext: Math.max(0, Math.floor(finiteNumber(accountRaw.xpForNext))),
      prestigeLevel: Math.max(0, Math.floor(finiteNumber(accountRaw.prestigeLevel))),
      rewards: accountRewards,
    },
    streak: {
      currentStreak: Math.max(0, Math.floor(finiteNumber(streakRaw.currentStreak))),
      bestStreak: Math.max(0, Math.floor(finiteNumber(streakRaw.bestStreak))),
      totalClaims: Math.max(0, Math.floor(finiteNumber(streakRaw.totalClaims))),
      claimedToday: Boolean(streakRaw.claimedToday),
      canClaim: Boolean(streakRaw.canClaim),
      nextDay: Math.max(1, Math.min(7, Math.floor(finiteNumber(streakRaw.nextDay, 1)))),
      nextReward: reward(nextRewardRaw),
      calendar,
      resetTimezone: text(streakRaw.resetTimezone, "UTC", 40),
    },
    achievements,
    newlyUnlocked: Math.max(0, Math.floor(finiteNumber(root.newlyUnlocked))),
  };
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("progression_snapshot_v064", { p_profile_id: profile.id });
  if (error) return apiFailure(error, "Не удалось загрузить прогресс");
  return NextResponse.json(progressionSnapshot(data), { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "progression-claim", String(profile.id), 30, 60))) {
    return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
  }
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const supabase = getSupabaseAdmin();

  if (body.action === "claim_streak") {
    const { data, error } = await supabase.rpc("claim_daily_streak_v064", { p_profile_id: profile.id });
    if (error) return apiFailure(error, "Не удалось получить ежедневную награду", 400);
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  }

  if (body.action === "claim_level") {
    const level = Number(body.level);
    if (!Number.isInteger(level) || level < 2 || level > 100) return NextResponse.json({ error: "Некорректный уровень" }, { status: 400 });
    const { data, error } = await supabase.rpc("claim_account_level_reward_v064", { p_profile_id: profile.id, p_level: level });
    if (error) {
      const message = errorMessage(error);
      if (/locked/i.test(message)) return NextResponse.json({ error: "Награда этого уровня ещё закрыта" }, { status: 409 });
      if (/not found/i.test(message)) return NextResponse.json({ error: "Награда уровня не найдена" }, { status: 404 });
      return apiFailure(error, "Не удалось получить награду уровня", 400);
    }
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}

export const GET = withApiErrors("app/api/progression/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/progression/route.ts:POST", POSTHandler);
