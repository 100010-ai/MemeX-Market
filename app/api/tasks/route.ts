import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { error: ensureError } = await supabase.rpc("ensure_user_missions", { p_profile_id: profile.id });
  if (ensureError) return NextResponse.json({ error: ensureError.message }, { status: 500 });
  const { data, error } = await supabase.from("user_missions_view").select("mission_id,key,period,title,description,reward,target,progress,claimed,action_type,sort_order").eq("profile_id", profile.id).order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ missions: (data || []).map((m: any) => ({
    id: m.mission_id,
    key: m.key,
    period: m.period,
    title: m.title,
    description: m.description,
    reward: Number(m.reward),
    target: Number(m.target),
    progress: Number(m.progress),
    claimed: Boolean(m.claimed),
    actionType: m.action_type,
  })) });
}
