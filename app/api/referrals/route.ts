import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig } from "@/lib/runtime-config";

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.referrals) return NextResponse.json({ error: "Реферальная программа временно отключена" }, { status: 503 });
  const supabase = getSupabaseAdmin();
  const [meResult, referredResult, rewardsResult, settingsResult, partnerResult] = await Promise.all([
    supabase.from("profiles").select("referral_code,referrer_profile_id").eq("id", profile.id).single(),
    supabase.from("profiles").select("id,username,first_name,photo_url,created_at").eq("referrer_profile_id", profile.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("referral_rewards").select("id,referred_profile_id,source_kind,source_amount,reward_amount,created_at").eq("referrer_profile_id", profile.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("economy_settings").select("referral_bonus_bps").eq("singleton", true).single(),
    supabase.rpc("referral_partner_status_v200", { p_profile_id: profile.id }),
  ]);
  const partnerMissing = partnerResult.error && (partnerResult.error.code === "42883" || /referral_partner_status_v200|schema cache|could not find the function/i.test(partnerResult.error.message || ""));
  const firstError = meResult.error || referredResult.error || rewardsResult.error || settingsResult.error || (partnerMissing ? null : partnerResult.error);
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
  const partner = partnerResult.data && typeof partnerResult.data === "object" && !Array.isArray(partnerResult.data)
    ? partnerResult.data as Record<string, unknown>
    : {
        level: "Bronze",
        bonusBps: Number(settingsResult.data?.referral_bonus_bps || 500),
        invited: referred.length,
        qualified: 0,
        nextQualified: 5,
        earnedVirtualTon: totalEarned,
        earnedMxmCoins: 0,
      };
  return NextResponse.json({
    code,
    inviteLink: code ? `https://t.me/${bot}?startapp=ref_${encodeURIComponent(code)}` : null,
    percent: Number(partner.bonusBps || settingsResult.data?.referral_bonus_bps || 500) / 100,
    partner: {
      level: String(partner.level || "Bronze"),
      bonusBps: Number(partner.bonusBps || 500),
      invited: Number(partner.invited || referred.length),
      qualified: Number(partner.qualified || 0),
      nextQualified: partner.nextQualified == null ? null : Number(partner.nextQualified),
      earnedVirtualTon: Number(partner.earnedVirtualTon || 0),
      earnedMxmCoins: Number(partner.earnedMxmCoins || 0),
    },
    invitedCount: referred.length,
    totalEarned,
    referred: referred.map((row) => ({ id: String(row.id), name: row.username ? `@${row.username}` : String(row.first_name || "Игрок"), photoUrl: row.photo_url, joinedAt: row.created_at })),
    rewards,
  }, { headers: { "cache-control": "private, no-store" } });
}
export const GET = withApiErrors("app/api/referrals/route.ts:GET", GETHandler);
