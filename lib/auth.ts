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

export async function requireProfile() {
  const session = await readSession();
  if (!session) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("profiles").select("*").eq("telegram_id", session.telegramId).single();
  if (error) throw error;
  if (!data) throw new Error("Authenticated Telegram profile is missing");
  return data;
}

export function tierForWorth(netWorth: number) {
  if (netWorth >= 10_000_000) return "Market Legend";
  if (netWorth >= 1_000_000) return "Tycoon";
  if (netWorth >= 250_000) return "Fund Manager";
  if (netWorth >= 50_000) return "Whale";
  if (netWorth >= 10_000) return "Market Maker";
  if (netWorth >= 2_000) return "Degen";
  if (netWorth >= 500) return "Trader";
  return "Newbie";
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

export async function getProfileSnapshot(profileRow: Record<string, unknown>) {
  const id = requiredString(profileRow.id, "id");
  const supabase = getSupabaseAdmin();
  const [leaderboardResult, offersResult] = await Promise.all([
    supabase.from("leaderboard").select("coin_value,gift_value,net_worth").eq("id", id).single(),
    supabase.from("gift_offers").select("amount").eq("buyer_profile_id", id).eq("status", "pending"),
  ]);
  if (leaderboardResult.error) throw leaderboardResult.error;
  if (offersResult.error) throw offersResult.error;
  if (!leaderboardResult.data) throw new Error("Profile is missing from leaderboard");

  const balance = requiredNumber(profileRow.balance, "balance");
  const reservedBalance = (offersResult.data || []).reduce((sum, row) => sum + requiredNumber(row.amount, "pending offer amount"), 0);
  const availableBalance = Math.max(0, balance - reservedBalance);
  const coinValue = requiredNumber(leaderboardResult.data.coin_value, "coin_value");
  const giftValue = requiredNumber(leaderboardResult.data.gift_value, "gift_value");
  const netWorth = requiredNumber(leaderboardResult.data.net_worth, "net_worth");
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
    reservedBalance,
    availableBalance,
    coinValue,
    giftValue,
    netWorth,
    pnl: netWorth - 100,
    tier: tierForWorth(netWorth),
    joinedAt,
    lastGiftSyncAt: profileRow.last_gift_sync_at == null ? null : String(profileRow.last_gift_sync_at),
    ...progression,
  };
}
