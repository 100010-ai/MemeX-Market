import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig } from "@/lib/runtime-config";

function dayKey(value: string) { return new Date(value).toISOString().slice(0, 10); }

export async function GET() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  const supabase = getSupabaseAdmin();
  const now = Date.now();
  const since24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const [overview, events, giftTrades, ads, errors, runtime, settings] = await Promise.all([
      supabase.rpc("admin_economy_overview_v056"),
      supabase.from("economy_events").select("profile_id,kind,amount,created_at").gte("created_at", since7).order("created_at", { ascending: true }).limit(10000),
      supabase.from("gift_trades").select("buyer_profile_id,seller_profile_id,price,created_at").gte("created_at", since24).order("created_at", { ascending: false }).limit(5000),
      supabase.from("rewarded_ad_sessions").select("profile_id,reward,status,claimed_at,verification_source").eq("status", "claimed").gte("claimed_at", since24).limit(5000),
      supabase.from("app_error_inbox_v056").select("route,error_name,message,count,affected_users,first_seen_at,last_seen_at").order("last_seen", { ascending: false }).limit(40),
      getRuntimeConfig(),
      supabase.from("economy_settings").select("rewarded_ad_daily_limit").eq("singleton", true).single(),
    ]);
    const firstError = overview.error || events.error || giftTrades.error || ads.error || errors.error || settings.error;
    if (firstError) throw firstError;

    const daily = new Map<string, { date: string; emission: number; burned: number; net: number }>();
    const recipients = new Map<string, number>();
    for (const event of events.data || []) {
      const amount = Number(event.amount || 0);
      const key = dayKey(String(event.created_at));
      const row = daily.get(key) || { date: key, emission: 0, burned: 0, net: 0 };
      if (amount > 0) row.emission += amount; else row.burned += -amount;
      row.net += amount; daily.set(key, row);
      if (event.profile_id && amount > 0 && new Date(String(event.created_at)).getTime() >= new Date(since24).getTime()) recipients.set(String(event.profile_id), (recipients.get(String(event.profile_id)) || 0) + amount);
    }

    const pairMap = new Map<string, { a: string; b: string; count: number; volume: number }>();
    for (const trade of giftTrades.data || []) {
      if (!trade.seller_profile_id || !trade.buyer_profile_id) continue;
      const ids = [String(trade.buyer_profile_id), String(trade.seller_profile_id)].sort();
      const key = `${ids[0]}:${ids[1]}`;
      const row = pairMap.get(key) || { a: ids[0], b: ids[1], count: 0, volume: 0 };
      row.count += 1; row.volume += Number(trade.price || 0); pairMap.set(key, row);
    }
    const washPairs = [...pairMap.values()].filter((row) => row.count >= 3).sort((a, b) => b.count - a.count || b.volume - a.volume).slice(0, 12);

    const adCounts = new Map<string, number>();
    for (const row of ads.data || []) adCounts.set(String(row.profile_id), (adCounts.get(String(row.profile_id)) || 0) + 1);
    const dailyLimit = Number(settings.data?.rewarded_ad_daily_limit || 0);
    const repeatedAdClaims = [...adCounts.entries()].filter(([, count]) => count > Math.max(1, dailyLimit)).map(([profileId, count]) => ({ profileId, count })).sort((a, b) => b.count - a.count).slice(0, 12);

    const topRecipients = [...recipients.entries()].map(([profileId, amount]) => ({ profileId, amount })).sort((a, b) => b.amount - a.amount).slice(0, 12);
    const ids = [...new Set([...washPairs.flatMap((row) => [row.a, row.b]), ...repeatedAdClaims.map((row) => row.profileId), ...topRecipients.map((row) => row.profileId)])];
    const people = ids.length ? await supabase.from("profiles").select("id,username,first_name").in("id", ids) : { data: [], error: null };
    if (people.error) throw people.error;
    const names = new Map((people.data || []).map((row) => [String(row.id), row.username ? `@${row.username}` : row.first_name]));

    return NextResponse.json({
      metrics: overview.data || {},
      daily: [...daily.values()],
      risks: {
        washPairs: washPairs.map((row) => ({ ...row, aName: names.get(row.a) || row.a, bName: names.get(row.b) || row.b })),
        repeatedAdClaims: repeatedAdClaims.map((row) => ({ ...row, name: names.get(row.profileId) || row.profileId })),
        topRecipients: topRecipients.map((row) => ({ ...row, name: names.get(row.profileId) || row.profileId })),
        errors: errors.data || [],
      },
      runtime,
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("economy risk", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось собрать Economy & Risk" }, { status: 500 });
  }
}
