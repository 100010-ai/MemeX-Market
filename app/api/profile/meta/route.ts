import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const refreshed = await supabase.rpc("refresh_profile_meta_v048", { p_profile_id: profile.id });
  if (refreshed.error) return NextResponse.json({ error: refreshed.error.message }, { status: 500 });
  const [reputation, achievements] = await Promise.all([
    supabase.from("profile_reputation").select("score,trade_score,age_score,activity_score,trust_score,updated_at").eq("profile_id", profile.id).single(),
    supabase.from("user_achievements").select("achievement_key,unlocked_at,achievements(title,description,icon,xp_reward,sort_order)").eq("profile_id", profile.id).order("unlocked_at", { ascending: false }),
  ]);
  const error = reputation.error || achievements.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reputation: { score: Number(reputation.data.score), tradeScore: Number(reputation.data.trade_score), ageScore: Number(reputation.data.age_score), activityScore: Number(reputation.data.activity_score), trustScore: Number(reputation.data.trust_score), updatedAt: reputation.data.updated_at }, achievements: (achievements.data || []).map((row: any) => ({ key: row.achievement_key, unlockedAt: row.unlocked_at, title: row.achievements?.title || row.achievement_key, description: row.achievements?.description || "", icon: row.achievements?.icon || "award", xpReward: Number(row.achievements?.xp_reward || 0) })) });
}
