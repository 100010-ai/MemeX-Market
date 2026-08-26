import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { finiteNumber, nullableText, safeIsoDate, text } from "@/lib/safe-data";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("league_hall_of_fame_snapshot_v0722");
  if (error) return apiFailure(error, "Не удалось загрузить Hall of Fame");
  const root = object(data);
  const seasons = Array.isArray(root.seasons) ? root.seasons.flatMap((raw) => {
    const season = object(raw); const id = text(season.id, "", 80); if (!id) return [];
    const winners = Array.isArray(season.winners) ? season.winners.flatMap((winnerRaw) => { const winner = object(winnerRaw); const winnerId = text(winner.id, "", 80); return winnerId ? [{ id: winnerId, rank: Math.max(1, Math.floor(finiteNumber(winner.rank))), name: text(winner.name, "Трейдер", 120), photoUrl: nullableText(winner.photoUrl, 2000), score: finiteNumber(winner.score), profit: finiteNumber(winner.profit), tradeVolume: finiteNumber(winner.tradeVolume) }] : []; }) : [];
    return [{ id, title: text(season.title, "MemeX League", 160), startsAt: safeIsoDate(season.startsAt), endsAt: safeIsoDate(season.endsAt), winners }];
  }) : [];
  return NextResponse.json({ seasons }, { headers: { "cache-control": "private, max-age=60" } });
}
export const GET = withApiErrors("app/api/hall-of-fame/route.ts:GET", GETHandler);
