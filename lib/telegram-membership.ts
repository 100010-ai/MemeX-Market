import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";

export const MAIN_CHANNEL_USERNAME = (() => {
  const configured = String(process.env.TELEGRAM_MAIN_CHANNEL_USERNAME || "Meme_X_Market").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(configured) ? configured : "Meme_X_Market";
})();

export const MAIN_CHANNEL_CHAT_ID = `@${MAIN_CHANNEL_USERNAME}`;
export const MAIN_CHANNEL_URL = `https://t.me/${MAIN_CHANNEL_USERNAME}`;
export const MAIN_CHANNEL_MISSION_KEY = "join_main_channel";

const MEMBERSHIP_TTL_MS = 5 * 60 * 1000;

type TelegramChatMember = {
  status?: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked" | string;
  is_member?: boolean;
};

type ChannelTaskState = {
  profile_id?: string;
  telegram_id?: number | string;
  currently_member?: boolean;
  member_status?: string | null;
  last_verified_at?: string | null;
  rewarded_at?: string | null;
  revoked_at?: string | null;
  reward_amount?: number | string | null;
  recovered_amount?: number | string | null;
  clawback_due?: number | string | null;
};

export type ChannelMembershipResult = {
  member: boolean;
  status: string;
  verifiedAt: string;
  rewardedAt: string | null;
  revokedAt: string | null;
  rewardAmount: number;
  recoveredAmount: number;
  clawbackDue: number;
  cached: boolean;
};

export function telegramChatMemberIsMember(result: TelegramChatMember | null | undefined) {
  const status = String(result?.status || "unknown");
  if (status === "creator" || status === "administrator" || status === "member") return true;
  if (status === "restricted") return result?.is_member === true;
  return false;
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stateResult(row: ChannelTaskState | null | undefined, cached: boolean): ChannelMembershipResult {
  return {
    member: Boolean(row?.currently_member),
    status: String(row?.member_status || (row?.currently_member ? "member" : "unknown")),
    verifiedAt: String(row?.last_verified_at || new Date(0).toISOString()),
    rewardedAt: row?.rewarded_at ? String(row.rewarded_at) : null,
    revokedAt: row?.revoked_at ? String(row.revoked_at) : null,
    rewardAmount: Math.max(0, numeric(row?.reward_amount)),
    recoveredAmount: Math.max(0, numeric(row?.recovered_amount)),
    clawbackDue: Math.max(0, numeric(row?.clawback_due)),
    cached,
  };
}

function isFresh(verifiedAt: unknown) {
  if (typeof verifiedAt !== "string" || !verifiedAt) return false;
  const time = Date.parse(verifiedAt);
  return Number.isFinite(time) && Date.now() - time < MEMBERSHIP_TTL_MS;
}

async function telegramMembership(telegramId: number) {
  try {
    const result = await telegramBotApi<TelegramChatMember>("getChatMember", {
      chat_id: MAIN_CHANNEL_CHAT_ID,
      user_id: telegramId,
    }, 8_000);
    return { member: telegramChatMemberIsMember(result), status: String(result?.status || "unknown") };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    // Telegram may answer "user not found" for an account that is not a member.
    if (message.includes("user not found") || message.includes("member not found") || message.includes("participant_id_invalid")) {
      return { member: false, status: "left" };
    }
    throw error;
  }
}

export async function applyMainChannelMembership(
  profileId: string,
  telegramId: number,
  member: boolean,
  status: string,
): Promise<ChannelMembershipResult> {
  const id = String(profileId || "").trim();
  if (!id || !Number.isSafeInteger(telegramId) || telegramId <= 0) throw new Error("Некорректный профиль Telegram");
  const supabase = getSupabaseAdmin();
  const applied = await supabase.rpc("apply_main_channel_membership_v700", {
    p_profile_id: id,
    p_telegram_id: telegramId,
    p_channel_username: MAIN_CHANNEL_USERNAME,
    p_is_member: member,
    p_member_status: String(status || "unknown").slice(0, 32),
  });
  if (applied.error) throw applied.error;
  const refreshed = await getMainChannelTaskState(id);
  if (!refreshed) throw new Error("Не удалось сохранить состояние подписки на канал");
  return { ...refreshed, cached: false };
}

export async function getMainChannelTaskState(profileId: string): Promise<ChannelMembershipResult | null> {
  const id = String(profileId || "").trim();
  if (!id) return null;
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("telegram_channel_task_state_v700")
    .select("profile_id,telegram_id,currently_member,member_status,last_verified_at,rewarded_at,revoked_at,reward_amount,recovered_amount,clawback_due")
    .eq("profile_id", id)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ? stateResult(result.data as ChannelTaskState, true) : null;
}

export async function verifyMainChannelMembership(
  profile: { id: string; telegram_id?: number | string; telegramId?: number | string },
  options: { force?: boolean } = {},
): Promise<ChannelMembershipResult> {
  const profileId = String(profile.id || "").trim();
  const telegramId = Number(profile.telegram_id ?? profile.telegramId);
  if (!profileId || !Number.isSafeInteger(telegramId) || telegramId <= 0) throw new Error("Некорректный профиль Telegram");

  const supabase = getSupabaseAdmin();
  const existing = await supabase
    .from("telegram_channel_task_state_v700")
    .select("profile_id,telegram_id,currently_member,member_status,last_verified_at,rewarded_at,revoked_at,reward_amount,recovered_amount,clawback_due")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (!options.force && existing.data && isFresh(existing.data.last_verified_at)) {
    return stateResult(existing.data as ChannelTaskState, true);
  }

  const membership = await telegramMembership(telegramId);
  return applyMainChannelMembership(profileId, telegramId, membership.member, membership.status);
}

/**
 * Cheap app-open audit: users who never claimed the conditional channel reward
 * only cost one indexed state lookup. Rewarded users are rechecked when the
 * cached Telegram membership verification becomes stale.
 */
export async function auditMainChannelRewardIfNeeded(profile: { id: string; telegram_id?: number | string; telegramId?: number | string }) {
  const state = await getMainChannelTaskState(profile.id);
  if (!state?.rewardedAt || state.revokedAt) return state;
  if (isFresh(state.verifiedAt)) return state;
  return verifyMainChannelMembership(profile, { force: true });
}
