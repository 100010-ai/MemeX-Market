import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, nullableText, safeIsoDate, text } from "@/lib/safe-data";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function division(value: unknown) {
  const row = object(value);
  return {
    key: text(row.key, "bronze", 32),
    label: text(row.label, "Bronze", 48),
    floor: Math.max(0, finiteNumber(row.floor)),
    nextScore: row.nextScore == null ? null : Math.max(0, finiteNumber(row.nextScore)),
  };
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("league_snapshot_v0722", { p_profile_id: profile.id });
  if (error) return apiFailure(error, "Не удалось загрузить лигу");
  const root = object(data);
  const season = object(root.season);
  const me = object(root.me);
  const leaders = Array.isArray(root.leaders) ? root.leaders.flatMap((raw) => {
    const row = object(raw);
    const id = text(row.id, "", 80);
    const rank = Math.max(1, Math.floor(finiteNumber(row.rank, 1)));
    if (!id) return [];
    return [{
      id,
      rank,
      name: text(row.name, "Игрок", 120),
      photoUrl: nullableText(row.photoUrl, 2_000),
      frame: nullableText(row.frame, 120),
      score: Math.max(0, finiteNumber(row.score)),
      profit: finiteNumber(row.profit),
      tradeVolume: Math.max(0, finiteNumber(row.tradeVolume)),
      tradeCount: Math.max(0, Math.floor(finiteNumber(row.tradeCount))),
      giftCount: Math.max(0, Math.floor(finiteNumber(row.giftCount))),
      activeDays: Math.max(0, Math.floor(finiteNumber(row.activeDays))),
      division: division(row.division),
      isMe: id === String(profile.id),
    }];
  }) : [];
  const seasonId = text(season.id, "", 80);
  if (!seasonId) return NextResponse.json({ error: "Данные лиги повреждены", code: "DATA_INTEGRITY" }, { status: 500 });
  return NextResponse.json({
    season: {
      id: seasonId,
      title: text(season.title, "MemeX League", 160),
      startsAt: safeIsoDate(season.startsAt),
      endsAt: safeIsoDate(season.endsAt),
      daysLeft: Math.max(0, Math.floor(finiteNumber(season.daysLeft))),
    },
    me: {
      rank: me.rank == null ? null : Math.max(1, Math.floor(finiteNumber(me.rank, 1))),
      score: Math.max(0, finiteNumber(me.score)),
      tradeVolume: Math.max(0, finiteNumber(me.tradeVolume)),
      tradeCount: Math.max(0, Math.floor(finiteNumber(me.tradeCount))),
      profit: finiteNumber(me.profit),
      giftCount: Math.max(0, Math.floor(finiteNumber(me.giftCount))),
      activeDays: Math.max(0, Math.floor(finiteNumber(me.activeDays))),
      gapToNext: me.gapToNext == null ? null : Math.max(0, finiteNumber(me.gapToNext)),
      division: division(me.division),
      nextDivisionScore: me.nextDivisionScore == null ? null : Math.max(0, finiteNumber(me.nextDivisionScore)),
      divisionProgress: Math.max(0, Math.min(100, finiteNumber(me.divisionProgress))),
    },
    leaders,
    rewards: Array.isArray(root.rewards) ? root.rewards : [],
    scoring: object(root.scoring),
  }, { headers: { "cache-control": "private, no-store" } });
}

export const GET = withApiErrors("app/api/league/route.ts:GET", GETHandler);
