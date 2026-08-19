import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readSession } from "@/lib/session";

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Profile field ${field} is missing`);
  return value;
}

function requiredNumber(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Profile field ${field} is invalid`);
  return number;
}

function banIsActive(row: Record<string, unknown>) {
  const bannedUntil = row.banned_until ? new Date(String(row.banned_until)).getTime() : null;
  return Boolean(row.is_banned) && (bannedUntil == null || bannedUntil > Date.now());
}

export async function requireProfile() {
  const session = await readSession();
  if (!session) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("profiles").select("id,telegram_id,username,first_name,last_name,photo_url,balance,xp,last_gift_sync_at,is_banned,banned_until,created_at").eq("telegram_id", session.telegramId).single();
  if (error) throw error;
  if (!data) throw new Error("Authenticated Telegram profile is missing");
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
};

function formatProfileSnapshot(profileRow: Record<string, unknown>, finance: FinanceSnapshot) {
  const id = requiredString(profileRow.id, "id");
  const balance = finance.balance;
  const availableBalance = Math.max(0, balance - finance.reservedBalance);
  const firstName = requiredString(profileRow.first_name, "first_name");
  const joinedAt = requiredString(profileRow.created_at, "created_at");
  const progression = progressionForXp(requiredNumber(profileRow.xp ?? 0, "xp"));

  return {
    id,
    telegramId: requiredNumber(profileRow.telegram_id, "telegram_id"),
    username: profileRow.username == null ? null : String(profileRow.username),
    firstName,
    lastName: profileRow.last_name == null ? null : String(profileRow.last_name),
    photoUrl: profileRow.photo_url == null ? null : String(profileRow.photo_url),
    balance,
    reservedBalance: finance.reservedBalance,
    availableBalance,
    coinValue: finance.coinValue,
    giftValue: finance.giftValue,
    netWorth: finance.netWorth,
    pnl: finance.netWorth - 100,
    tier: tierForWorth(finance.netWorth),
    joinedAt,
    lastGiftSyncAt: profileRow.last_gift_sync_at == null ? null : String(profileRow.last_gift_sync_at),
    ...progression,
  };
}

export async function getProfileSnapshot(profileRow: Record<string, unknown>) {
  const id = requiredString(profileRow.id, "id");
  const supabase = getSupabaseAdmin();

  let finance: FinanceSnapshot = {
    balance: requiredNumber(profileRow.balance, "balance"),
    reservedBalance: 0,
    coinValue: 0,
    giftValue: 0,
    netWorth: requiredNumber(profileRow.balance, "balance"),
  };

  const fastSnapshot = await supabase.rpc("profile_snapshot_v040", { p_profile_id: id });
  if (!fastSnapshot.error && fastSnapshot.data) {
    const row = fastSnapshot.data as Record<string, unknown>;
    finance = {
      balance: requiredNumber(row.balance, "balance"),
      reservedBalance: requiredNumber(row.reservedBalance ?? 0, "reserved balance"),
      coinValue: requiredNumber(row.coinValue ?? 0, "coin value"),
      giftValue: requiredNumber(row.giftValue ?? 0, "gift value"),
      netWorth: requiredNumber(row.netWorth ?? row.balance, "net worth"),
    };
  } else {
    const missingFastRpc = fastSnapshot.error && (fastSnapshot.error.code === "42883" || /profile_snapshot_v040|schema cache|could not find the function/i.test(fastSnapshot.error.message || ""));
    if (fastSnapshot.error && !missingFastRpc) throw fastSnapshot.error;
    const [leaderboardResult, reservedResult] = await Promise.all([
      supabase.from("profile_financial_overview").select("coin_value,gift_value,net_worth").eq("id", id).single(),
      supabase.rpc("pending_gift_offer_total", { p_profile_id: id, p_exclude_virtual_gift_id: null }),
    ]);
    if (leaderboardResult.error) throw leaderboardResult.error;
    if (reservedResult.error) throw reservedResult.error;
    if (!leaderboardResult.data) throw new Error("Profile financial snapshot is missing");
    finance = {
      balance: requiredNumber(profileRow.balance, "balance"),
      reservedBalance: requiredNumber(reservedResult.data ?? 0, "reserved balance"),
      coinValue: requiredNumber(leaderboardResult.data.coin_value, "coin_value"),
      giftValue: requiredNumber(leaderboardResult.data.gift_value, "gift_value"),
      netWorth: requiredNumber(leaderboardResult.data.net_worth, "net_worth"),
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

  if (!result.error && result.data) {
    const row = result.data as Record<string, unknown>;
    if (banIsActive(row)) return null;
    return formatProfileSnapshot(row, {
      balance: requiredNumber(row.balance, "balance"),
      reservedBalance: requiredNumber(row.reserved_balance ?? 0, "reserved balance"),
      coinValue: requiredNumber(row.coin_value ?? 0, "coin value"),
      giftValue: requiredNumber(row.gift_value ?? 0, "gift value"),
      netWorth: requiredNumber(row.net_worth ?? row.balance, "net worth"),
    });
  }

  const missingRpc = result.error && (result.error.code === "42883" || /session_profile_snapshot_v040|schema cache|could not find the function/i.test(result.error.message || ""));
  if (result.error && !missingRpc) throw result.error;

  // Rolling deploy compatibility: old database + new frontend keeps working
  // until migration 018 is applied.
  const profile = await requireProfile();
  return profile ? getProfileSnapshot(profile as Record<string, unknown>) : null;
}
