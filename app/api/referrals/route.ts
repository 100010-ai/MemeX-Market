import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { finiteNumber, nullableText, safeIsoDate, text } from "@/lib/safe-data";

function partnerLevelLabel(value: unknown) {
  const level = text(value, "bronze", 32).toLowerCase();
  if (level === "silver") return "Серебро";
  if (level === "gold") return "Золото";
  if (level === "platinum") return "Платина";
  if (level === "diamond") return "Бриллиант";
  return "Бронза";
}

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
  const firstError = meResult.error || referredResult.error || rewardsResult.error || settingsResult.error || partnerResult.error;
  if (firstError) return apiFailure(firstError, "Не удалось загрузить реферальную систему");
  if (!partnerResult.data || typeof partnerResult.data !== "object" || Array.isArray(partnerResult.data)) {
    return NextResponse.json({ error: "Реферальные данные повреждены", code: "DATA_INTEGRITY" }, { status: 500 });
  }

  const partner = partnerResult.data as Record<string, unknown>;
  const partnerInvited = Math.max(0, Math.floor(finiteNumber(partner.invited)));
  const partnerQualified = Math.max(0, Math.floor(finiteNumber(partner.qualified)));
  const partnerEarnedVirtualTon = Math.max(0, finiteNumber(partner.earnedVirtualTon));
  const partnerEarnedMxmCoins = Math.max(0, finiteNumber(partner.earnedMxmCoins));
  const referred = referredResult.data || [];
  const people = new Map(referred.map((row) => [String(row.id), row]));
  const rewards = (rewardsResult.data || []).map((row) => ({
    id: String(row.id),
    sourceKind: String(row.source_kind),
    sourceAmount: Math.max(0, finiteNumber(row.source_amount)),
    rewardAmount: Math.max(0, finiteNumber(row.reward_amount)),
    createdAt: safeIsoDate(row.created_at),
    referred: people.get(String(row.referred_profile_id)) || null,
  }));
  const code = String(meResult.data?.referral_code || "");
  const bot = String(process.env.NEXT_PUBLIC_BOT_USERNAME || "MemeXMarketBot").replace(/^@/, "");
  return NextResponse.json({
    code,
    inviteLink: code ? `https://t.me/${bot}?startapp=ref_${encodeURIComponent(code)}` : null,
    percent: Math.max(0, finiteNumber(partner.bonusBps ?? settingsResult.data?.referral_bonus_bps)) / 100,
    partner: {
      level: partnerLevelLabel(partner.level),
      bonusBps: Math.max(0, finiteNumber(partner.bonusBps ?? settingsResult.data?.referral_bonus_bps)),
      invited: partnerInvited,
      qualified: partnerQualified,
      nextQualified: partner.nextQualified == null ? null : Math.max(0, Math.floor(finiteNumber(partner.nextQualified))),
      earnedVirtualTon: partnerEarnedVirtualTon,
      earnedMxmCoins: partnerEarnedMxmCoins,
    },
    // These legacy top-level fields must describe the full account history, not
    // the deliberately bounded recent lists below.
    invitedCount: partnerInvited,
    totalEarned: partnerEarnedVirtualTon,
    referred: referred.flatMap((row) => {
      const id = text(row.id, "", 80);
      if (!id) return [];
      const username = nullableText(row.username, 64);
      return [{ id, name: username ? `@${username}` : text(row.first_name, "Игрок", 120), photoUrl: nullableText(row.photo_url, 2_000), joinedAt: safeIsoDate(row.created_at) }];
    }),
    rewards,
  }, { headers: { "cache-control": "private, no-store" } });
}
export const GET = withApiErrors("app/api/referrals/route.ts:GET", GETHandler);
