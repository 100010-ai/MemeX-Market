import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { finiteNumber, nullableText, text } from "@/lib/safe-data";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("market_radar_snapshot_v0722");
  if (error) return apiFailure(error, "Не удалось загрузить Trending Radar");
  const root = object(data);
  const gifts = Array.isArray(root.gifts) ? root.gifts.flatMap((raw) => { const row = object(raw); const id = text(row.id, "", 80); return id ? [{ id, name: text(row.name, "Подарок", 160), imageUrl: nullableText(row.imageUrl, 2000), volume: Math.max(0, finiteNumber(row.volume)), tradeCount: Math.max(0, Math.floor(finiteNumber(row.tradeCount))) }] : []; }) : [];
  const coins = Array.isArray(root.coins) ? root.coins.flatMap((raw) => { const row = object(raw); const id = text(row.id, "", 80); return id ? [{ id, name: text(row.name, "Мемкоин", 120), symbol: text(row.symbol, "MXM", 24), imageUrl: nullableText(row.imageUrl, 2000), change24h: finiteNumber(row.change24h), volume24h: Math.max(0, finiteNumber(row.volume24h)), tradeCount24h: Math.max(0, Math.floor(finiteNumber(row.tradeCount24h))) }] : []; }) : [];
  const activity = object(root.activity);
  return NextResponse.json({ gifts, coins, activity: { tradeCount: Math.max(0, Math.floor(finiteNumber(activity.tradeCount))), volume: Math.max(0, finiteNumber(activity.volume)) } }, { headers: { "cache-control": "private, max-age=30" } });
}
export const GET = withApiErrors("app/api/market/radar/route.ts:GET", GETHandler);
