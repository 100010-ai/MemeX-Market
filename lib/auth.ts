import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readSession } from "@/lib/session";

export async function requireProfile() {
  const session = await readSession();
  if (!session) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("profiles").select("*").eq("telegram_id", session.telegramId).single();
  if (error || !data) return null;
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
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("leaderboard").select("coin_value,gift_value,net_worth").eq("id", String(profileRow.id)).maybeSingle();
  const balance = Number(profileRow.balance ?? 0);
  const coinValue = Number(data?.coin_value ?? 0);
  const giftValue = Number(data?.gift_value ?? 0);
  const netWorth = Number(data?.net_worth ?? balance + coinValue + giftValue);
  return {
    id: String(profileRow.id),
    telegramId: Number(profileRow.telegram_id),
    username: profileRow.username ? String(profileRow.username) : null,
    firstName: String(profileRow.first_name ?? "Trader"),
    lastName: profileRow.last_name ? String(profileRow.last_name) : null,
    photoUrl: profileRow.photo_url ? String(profileRow.photo_url) : null,
    balance,
    coinValue,
    giftValue,
    netWorth,
    pnl: netWorth - 100,
    tier: tierForWorth(netWorth),
    joinedAt: String(profileRow.created_at ?? new Date().toISOString()),
    lastGiftSyncAt: profileRow.last_gift_sync_at ? String(profileRow.last_gift_sync_at) : null,
  };
}
