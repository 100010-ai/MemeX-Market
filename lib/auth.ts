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

export async function getProfileSnapshot(profileRow: Record<string, unknown>) {
  const id = requiredString(profileRow.id, "id");
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("leaderboard").select("coin_value,gift_value,net_worth").eq("id", id).single();
  if (error) throw error;
  if (!data) throw new Error("Profile is missing from leaderboard");

  const balance = requiredNumber(profileRow.balance, "balance");
  const coinValue = requiredNumber(data.coin_value, "coin_value");
  const giftValue = requiredNumber(data.gift_value, "gift_value");
  const netWorth = requiredNumber(data.net_worth, "net_worth");
  const firstName = requiredString(profileRow.first_name, "first_name");
  const joinedAt = requiredString(profileRow.created_at, "created_at");

  return {
    id,
    telegramId: requiredNumber(profileRow.telegram_id, "telegram_id"),
    username: profileRow.username == null ? null : String(profileRow.username),
    firstName,
    lastName: profileRow.last_name == null ? null : String(profileRow.last_name),
    photoUrl: profileRow.photo_url == null ? null : String(profileRow.photo_url),
    balance,
    coinValue,
    giftValue,
    netWorth,
    pnl: netWorth - 100,
    tier: tierForWorth(netWorth),
    joinedAt,
    lastGiftSyncAt: profileRow.last_gift_sync_at == null ? null : String(profileRow.last_gift_sync_at),
  };
}
