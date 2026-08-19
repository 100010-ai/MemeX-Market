import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const [meResult, referredResult, rewardsResult, settingsResult] = await Promise.all([
    supabase.from("profiles").select("referral_code,referrer_profile_id").eq("id", profile.id).single(),
    supabase.from("profiles").select("id,username,first_name,photo_url,created_at").eq("referrer_profile_id", profile.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("referral_rewards").select("id,referred_profile_id,source_kind,source_amount,reward_amount,created_at").eq("referrer_profile_id", profile.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("economy_settings").select("referral_bonus_bps").eq("singleton", true).single(),
  ]);
  const firstError = meResult.error || referredResult.error || rewardsResult.error || settingsResult.error;
  if (firstError) {
    const migrationMissing = /referral|schema cache|column .* does not exist|relation .* does not exist/i.test(firstError.message || "");
    return NextResponse.json({ error: migrationMissing ? "Примените миграцию 021_v046_stars_referrals_market_polish.sql" : "Не удалось загрузить реферальную систему" }, { status: 500 });
  }
  const referred = referredResult.data || [];
  const people = new Map(referred.map((row) => [String(row.id), row]));
  const rewards = (rewardsResult.data || []).map((row) => ({
    id: String(row.id),
    sourceKind: String(row.source_kind),
    sourceAmount: Number(row.source_amount),
    rewardAmount: Number(row.reward_amount),
    createdAt: String(row.created_at),
    referred: people.get(String(row.referred_profile_id)) || null,
  }));
  const totalEarned = rewards.reduce((sum, row) => sum + row.rewardAmount, 0);
  const code = String(meResult.data?.referral_code || "");
  const bot = String(process.env.NEXT_PUBLIC_BOT_USERNAME || "MemeXMarketBot").replace(/^@/, "");
  return NextResponse.json({
    code,
    inviteLink: code ? `https://t.me/${bot}?startapp=ref_${encodeURIComponent(code)}` : null,
    percent: Number(settingsResult.data?.referral_bonus_bps || 500) / 100,
    invitedCount: referred.length,
    totalEarned,
    referred: referred.map((row) => ({ id: String(row.id), name: row.username ? `@${row.username}` : String(row.first_name || "Игрок"), photoUrl: row.photo_url, joinedAt: row.created_at })),
    rewards,
  }, { headers: { "cache-control": "private, no-store" } });
}
