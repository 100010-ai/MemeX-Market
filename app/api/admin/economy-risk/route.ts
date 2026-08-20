import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig } from "@/lib/runtime-config";

type DailyRow = { date: string; emission: number; burned: number; net: number };
type WashPair = { a: string; b: string; count: number; volume: number };
type Recipient = { profileId: string; amount: number };
type ActivityPayload = { daily?: DailyRow[]; washPairs?: WashPair[]; topRecipients?: Recipient[] };

function objectPayload(value: unknown): ActivityPayload {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ActivityPayload : {};
}

export async function GET() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  const supabase = getSupabaseAdmin();
  try {
    const [overview, activity, errors, runtime] = await Promise.all([
      supabase.rpc("admin_economy_overview_v028"),
      supabase.rpc("admin_economy_activity_v028"),
      supabase.from("app_error_inbox_v056")
        .select("route,error_name,message,count,affected_users,first_seen_at,last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(40),
      getRuntimeConfig(),
    ]);
    const firstError = overview.error || activity.error || errors.error;
    if (firstError) throw firstError;

    const activityData = objectPayload(activity.data);
    const washPairs = Array.isArray(activityData.washPairs) ? activityData.washPairs : [];
    const topRecipients = Array.isArray(activityData.topRecipients) ? activityData.topRecipients : [];
    const ids = [...new Set([
      ...washPairs.flatMap((row) => [String(row.a), String(row.b)]),
      ...topRecipients.map((row) => String(row.profileId)),
    ])];
    const people = ids.length
      ? await supabase.from("profiles").select("id,username,first_name").in("id", ids)
      : { data: [], error: null };
    if (people.error) throw people.error;
    const names = new Map((people.data || []).map((row) => [String(row.id), row.username ? `@${row.username}` : row.first_name]));

    return NextResponse.json({
      metrics: overview.data || {},
      daily: Array.isArray(activityData.daily) ? activityData.daily : [],
      risks: {
        washPairs: washPairs.map((row) => ({ ...row, aName: names.get(String(row.a)) || row.a, bName: names.get(String(row.b)) || row.b })),
        topRecipients: topRecipients.map((row) => ({ ...row, name: names.get(String(row.profileId)) || row.profileId })),
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
