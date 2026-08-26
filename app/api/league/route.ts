import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { finiteNumber, nullableText, safeIsoDate, text } from "@/lib/safe-data";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("league_snapshot_v0722", { p_profile_id: profile.id });
  if (error) return apiFailure(error, "Не удалось загрузить MemeX League");
  const root = object(data);
  const season = object(root.season);
  const me = object(root.me);
  const leaders = Array.isArray(root.leaders) ? root.leaders.flatMap((raw) => {
    const row = object(raw);
    const id = text(row.id, "", 80);
    const rank = Math.max(1, Math.floor(finiteNumber(row.rank)));
    if (!id || !rank) return [];
    return [{
      id, rank, name: text(row.name, "Трейдер", 120), photoUrl: nullableText(row.photoUrl, 2000), frame: nullableText(row.frame, 120),
      score: finiteNumber(row.score), profit: finiteNumber(row.profit), tradeVolume: finiteNumber(row.tradeVolume),
      tradeCount: Math.max(0, Math.floor(finiteNumber(row.tradeCount))), giftCount: Math.max(0, Math.floor(finiteNumber(row.giftCount))), activeDays: Math.max(0, Math.floor(finiteNumber(row.activeDays))),
    }];
  }) : [];
  const rewards = Array.isArray(root.rewards) ? root.rewards.flatMap((raw) => {
    const row = object(raw); const rank = text(row.rank, "", 30); const title = text(row.title, "", 120); const itemKey = text(row.itemKey, "", 120);
    return rank && title && itemKey ? [{ rank, title, itemKey }] : [];
  }) : [];
  return NextResponse.json({
    season: { id: text(season.id, "", 80), title: text(season.title, "MemeX League", 160), startsAt: safeIsoDate(season.startsAt), endsAt: safeIsoDate(season.endsAt), daysLeft: Math.max(0, Math.floor(finiteNumber(season.daysLeft))) },
    me: { rank: me.rank == null ? null : Math.max(1, Math.floor(finiteNumber(me.rank))), score: finiteNumber(me.score), tradeVolume: finiteNumber(me.tradeVolume), tradeCount: Math.max(0, Math.floor(finiteNumber(me.tradeCount))), profit: finiteNumber(me.profit), giftCount: Math.max(0, Math.floor(finiteNumber(me.giftCount))), activeDays: Math.max(0, Math.floor(finiteNumber(me.activeDays))), gapToNext: me.gapToNext == null ? null : Math.max(0, finiteNumber(me.gapToNext)) },
    leaders, rewards,
  }, { headers: { "cache-control": "private, no-store" } });
}

export const GET = withApiErrors("app/api/league/route.ts:GET", GETHandler);
