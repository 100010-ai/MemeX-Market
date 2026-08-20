import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { REWARDED_AD_COOLDOWN_MINUTES, REWARDED_AD_DAILY_LIMIT, REWARDED_AD_REWARD_TON } from "@/lib/economy";
import { rewardedAdsConfig } from "@/lib/rewarded-ads";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { adsgramModerationMode } from "@/lib/feature-flags";

export const runtime = "nodejs";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });

  const config = rewardedAdsConfig();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("rewarded_ad_status_v045", { p_profile_id: profile.id });
  if (error) {
    const migrationMissing = error.code === "42883" || /rewarded_ad_status_v045|schema cache|could not find the function/i.test(error.message || "");
    if (migrationMissing) {
      return NextResponse.json({
        configured: config.configured,
        verificationMode: config.verificationMode,
        migrationRequired: true,
        reward: REWARDED_AD_REWARD_TON,
        dailyLimit: REWARDED_AD_DAILY_LIMIT,
        claimedToday: 0,
        remainingToday: 0,
        cooldownMinutes: REWARDED_AD_COOLDOWN_MINUTES,
        nextAvailableAt: null,
        activeSessionId: null,
        canStart: false,
      }, { headers: { "cache-control": "private, no-store" } });
    }
    console.error("rewarded ad status", error);
    return NextResponse.json({ error: "Не удалось проверить рекламную награду" }, { status: 500 });
  }

  const payload = (data || {}) as Record<string, unknown>;
  const moderationMismatch = adsgramModerationMode() && (Number(payload.reward || 0) > 1 || Number(payload.dailyLimit || 0) > 3);
  return NextResponse.json({
    configured: config.configured,
    verificationMode: config.verificationMode,
    migrationRequired: moderationMismatch,
    ...payload,
    ...(moderationMismatch ? { canStart: false } : {}),
  }, { headers: { "cache-control": "private, no-store" } });
}
