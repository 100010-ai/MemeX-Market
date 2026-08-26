import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, nullableNumber, nullableText, record, safeIsoDate, text } from "@/lib/safe-data";

function creatorDashboardSnapshot(value: unknown) {
  const root = record(value);
  if (!root) return null;
  const level = record(root.level) ?? {};
  const totals = record(root.totals) ?? {};
  const entitlements = Array.isArray(root.entitlements) ? root.entitlements : [];
  const coins = Array.isArray(root.coins) ? root.coins : [];
  return {
    verified: false,
    verificationTier: null as string | null,
    analyticsUnlocked: root.analyticsUnlocked === true,
    level: {
      name: text(level.name, "Bronze", 32),
      creatorFeeBps: Math.max(0, finiteNumber(level.creatorFeeBps)),
      platformFeeBps: Math.max(0, finiteNumber(level.platformFeeBps)),
      holderCount: Math.max(0, finiteNumber(level.holderCount)),
      volume: Math.max(0, finiteNumber(level.volume)),
      nextVolume: nullableNumber(level.nextVolume),
    },
    totals: {
      coins: Math.max(0, finiteNumber(totals.coins)),
      holders: Math.max(0, finiteNumber(totals.holders)),
      volume: Math.max(0, finiteNumber(totals.volume)),
      creatorFees: Math.max(0, finiteNumber(totals.creatorFees)),
    },
    entitlements: entitlements.flatMap((item) => {
      const row = record(item);
      if (!row) return [];
      const key = text(row.key, "", 80);
      if (!key || key === "creator_verified") return [];
      return [{ key, expiresAt: row.expiresAt == null ? null : safeIsoDate(row.expiresAt) }];
    }),
    coins: coins.flatMap((item) => {
      const row = record(item);
      if (!row) return [];
      const id = text(row.id, "", 80);
      const name = text(row.name, "", 64);
      const symbol = text(row.symbol, "", 16);
      if (!id || !name || !symbol) return [];
      const floor = nullableNumber(row.floorPrice);
      const boostedUntil = row.boostedUntil == null ? null : safeIsoDate(row.boostedUntil);
      return [{
        id, name, symbol, imageUrl: nullableText(row.imageUrl, 1000),
        status: text(row.status, "active", 24),
        currentPrice: Math.max(0, finiteNumber(row.currentPrice)),
        marketCap: Math.max(0, finiteNumber(row.marketCap)),
        floorPrice: floor == null ? null : Math.max(0, floor),
        floorActive: row.floorActive === true,
        holders: Math.max(0, finiteNumber(row.holders)),
        volume: Math.max(0, finiteNumber(row.volume)),
        creatorFees: Math.max(0, finiteNumber(row.creatorFees)),
        uniqueBuyers: row.uniqueBuyers == null ? null : Math.max(0, finiteNumber(row.uniqueBuyers)),
        buyerRetentionPct: row.buyerRetentionPct == null ? null : Math.min(100, Math.max(0, finiteNumber(row.buyerRetentionPct))),
        buySellRatio: row.buySellRatio == null ? null : Math.max(0, finiteNumber(row.buySellRatio)),
        boostedUntil,
        verified: false,
        verificationTier: null as string | null,
        createdAt: safeIsoDate(row.createdAt),
      }];
    }),
  };
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const [dashboard, creatorVerification, coinVerifications, requests] = await Promise.all([
    supabase.rpc("creator_dashboard_v200", { p_profile_id: profile.id }),
    supabase.from("creator_verifications_v071").select("tier,verified_at").eq("profile_id", profile.id).is("revoked_at", null).maybeSingle(),
    supabase.from("coin_verifications_v071").select("coin_id,tier,verified_at,coins!inner(creator_profile_id)").eq("coins.creator_profile_id", profile.id).is("revoked_at", null),
    supabase.from("verification_requests_v071").select("id,target_type,coin_id,status,requested_at,reviewed_at,review_note,tier").eq("profile_id", profile.id).order("requested_at", { ascending: false }).limit(30),
  ]);
  const error = dashboard.error || creatorVerification.error || coinVerifications.error || requests.error;
  if (error) return apiFailure(error, "Не удалось загрузить кабинет создателя");
  const snapshot = creatorDashboardSnapshot(dashboard.data);
  if (!snapshot) return NextResponse.json({ error: "Некорректные данные кабинета автора", code: "DATA_INTEGRITY" }, { status: 500 });
  const verifiedCoins = new Map((coinVerifications.data || []).map((row) => [row.coin_id, row.tier]));
  snapshot.verified = Boolean(creatorVerification.data);
  snapshot.verificationTier = creatorVerification.data?.tier || null;
  snapshot.coins = snapshot.coins.map((coin) => ({ ...coin, verified: verifiedCoins.has(coin.id), verificationTier: verifiedCoins.get(coin.id) || null }));
  return NextResponse.json({ ...snapshot, verificationRequests: requests.data || [] }, { headers: { "cache-control": "private, no-store" } });
}
export const GET = withApiErrors("app/api/creator/route.ts:GET", GETHandler);
