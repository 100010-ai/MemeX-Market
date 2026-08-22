import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readSession } from "@/lib/session";

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeDate(value: unknown, fallback = new Date(0).toISOString()) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function banIsActive(row: Record<string, unknown>) {
  const bannedUntil = row.banned_until ? new Date(String(row.banned_until)).getTime() : null;
  return Boolean(row.is_banned) && (bannedUntil == null || bannedUntil > Date.now());
}

export async function requireProfile() {
  const session = await readSession();
  if (!session) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("profiles").select("id,telegram_id,username,first_name,last_name,photo_url,balance,xp,last_gift_sync_at,is_banned,banned_until,created_at").eq("telegram_id", session.telegramId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (banIsActive(data as Record<string, unknown>)) return null;
  return data;
}

export function tierForWorth(netWorth: number) {
  if (netWorth >= 10_000_000) return "Легенда рынка";
  if (netWorth >= 1_000_000) return "Магнат";
  if (netWorth >= 250_000) return "Управляющий";
  if (netWorth >= 50_000) return "Кит";
  if (netWorth >= 10_000) return "Маркет-мейкер";
  if (netWorth >= 2_000) return "Деген";
  if (netWorth >= 500) return "Трейдер";
  return "Новичок";
}

export function progressionForXp(rawXp: number) {
  const xp = Math.max(0, Math.floor(rawXp));
  const level = Math.max(1, Math.floor(Math.sqrt(xp / 25)) + 1);
  const levelStart = 25 * Math.pow(level - 1, 2);
  const nextLevelAt = 25 * Math.pow(level, 2);
  const span = Math.max(1, nextLevelAt - levelStart);
  return {
    xp,
    level,
    levelProgress: Math.max(0, Math.min(1, (xp - levelStart) / span)),
    xpForNextLevel: Math.max(0, nextLevelAt - xp),
  };
}

type FinanceSnapshot = {
  balance: number;
  reservedBalance: number;
  coinValue: number;
  giftValue: number;
  netWorth: number;
  realizedPnl: number;
};

function formatProfileSnapshot(profileRow: Record<string, unknown>, finance: FinanceSnapshot) {
  const id = safeString(profileRow.id);
  const balance = safeNumber(finance.balance);
  const reservedBalance = Math.max(0, safeNumber(finance.reservedBalance));
  const availableBalance = Math.max(0, balance - reservedBalance);
  const username = safeString(profileRow.username) || null;
  const firstName = safeString(profileRow.first_name, username ? username.replace(/^@/, "") : "Telegram User");
  const joinedAt = safeDate(profileRow.created_at);
  const progression = progressionForXp(safeNumber(profileRow.xp));

  return {
    id,
    telegramId: safeNumber(profileRow.telegram_id),
    username,
    firstName,
    lastName: safeString(profileRow.last_name) || null,
    photoUrl: safeString(profileRow.photo_url) || null,
    balance,
    reservedBalance,
    availableBalance,
    coinValue: safeNumber(finance.coinValue),
    giftValue: safeNumber(finance.giftValue),
    netWorth: safeNumber(finance.netWorth, balance),
    pnl: safeNumber(finance.realizedPnl),
    tier: tierForWorth(safeNumber(finance.netWorth, balance)),
    joinedAt,
    lastGiftSyncAt: profileRow.last_gift_sync_at == null ? null : safeDate(profileRow.last_gift_sync_at),
    ...progression,
  };
}

export async function getProfileSnapshot(profileRow: Record<string, unknown>) {
  const id = safeString(profileRow.id);
  const supabase = getSupabaseAdmin();

  let finance: FinanceSnapshot = {
    balance: safeNumber(profileRow.balance),
    reservedBalance: 0,
    coinValue: 0,
    giftValue: 0,
    netWorth: safeNumber(profileRow.balance),
    realizedPnl: 0,
  };

  if (!id) return formatProfileSnapshot(profileRow, finance);

  const fastSnapshot = await supabase.rpc("profile_snapshot_v040", { p_profile_id: id });
  if (fastSnapshot.error) throw fastSnapshot.error;
  if (fastSnapshot.data) {
    const row = fastSnapshot.data as Record<string, unknown>;
    finance = {
      balance: safeNumber(row.balance),
      reservedBalance: safeNumber(row.reservedBalance),
      coinValue: safeNumber(row.coinValue),
      giftValue: safeNumber(row.giftValue),
      netWorth: safeNumber(row.netWorth, safeNumber(row.balance)),
      realizedPnl: safeNumber(row.realizedPnl),
    };
  }


  return formatProfileSnapshot(profileRow, finance);
}

/** Fast /api/me path: signed Telegram session + profile/finance snapshot in one DB call. */
export async function getSessionProfileSnapshot() {
  const session = await readSession();
  if (!session) return null;
  const supabase = getSupabaseAdmin();
  const result = await supabase.rpc("session_profile_snapshot_v040", { p_telegram_id: session.telegramId });
  if (result.error) throw result.error;
  if (!result.data) return null;
  const row = result.data as Record<string, unknown>;
  if (banIsActive(row)) return null;
  return formatProfileSnapshot(row, {
    balance: safeNumber(row.balance),
    reservedBalance: safeNumber(row.reserved_balance),
    coinValue: safeNumber(row.coin_value),
    giftValue: safeNumber(row.gift_value),
    netWorth: safeNumber(row.net_worth, safeNumber(row.balance)),
    realizedPnl: safeNumber(row.realized_pnl),
  });
}
