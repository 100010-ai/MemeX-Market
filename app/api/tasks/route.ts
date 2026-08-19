import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function missingSponsoredSchema(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42P01" || /sponsored_campaigns|sponsored_task_claims|schema cache/i.test(error.message || "")));
}

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { error: ensureError } = await supabase.rpc("ensure_user_missions", { p_profile_id: profile.id });
  if (ensureError) return NextResponse.json({ error: ensureError.message }, { status: 500 });

  const [missionResult, campaignsResult, claimsResult] = await Promise.all([
    supabase.from("user_missions_view").select("mission_id,key,period,title,description,reward,target,progress,claimed,action_type,sort_order").eq("profile_id", profile.id).neq("key", "daily_game_3").order("sort_order", { ascending: true }),
    supabase.from("sponsored_campaigns").select("id,advertiser_name,title,description,instructions,verification_type,target_url,button_label,reward,max_completions,completed_count,status,starts_at,ends_at,priority,featured").eq("status", "active").order("featured", { ascending: false }).order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    supabase.from("sponsored_task_claims").select("campaign_id,status,opened_at,submitted_at,claimed_at").eq("profile_id", profile.id).limit(200),
  ]);

  if (missionResult.error) return NextResponse.json({ error: missionResult.error.message }, { status: 500 });
  if (campaignsResult.error && !missingSponsoredSchema(campaignsResult.error)) return NextResponse.json({ error: campaignsResult.error.message }, { status: 500 });
  if (claimsResult.error && !missingSponsoredSchema(claimsResult.error)) return NextResponse.json({ error: claimsResult.error.message }, { status: 500 });

  const claimByCampaign = new Map((claimsResult.data || []).map((row) => [String(row.campaign_id), row]));
  const now = Date.now();
  const sponsored = (campaignsResult.data || [])
    .filter((row) => (!row.starts_at || new Date(row.starts_at).getTime() <= now) && (!row.ends_at || new Date(row.ends_at).getTime() > now) && Number(row.completed_count) < Number(row.max_completions))
    .map((row) => {
      const claim = claimByCampaign.get(String(row.id));
      return {
        id: String(row.id),
        advertiserName: String(row.advertiser_name),
        title: String(row.title),
        description: String(row.description || ""),
        instructions: String(row.instructions || ""),
        verificationType: row.verification_type as "telegram_membership" | "link_visit" | "manual",
        targetUrl: String(row.target_url),
        buttonLabel: String(row.button_label || "Открыть"),
        reward: Number(row.reward || 0),
        remainingSlots: Math.max(0, Number(row.max_completions) - Number(row.completed_count)),
        featured: Boolean(row.featured),
        claimStatus: claim?.status ? String(claim.status) : null,
      };
    });

  return NextResponse.json({
    missions: (missionResult.data || []).map((m) => ({
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
    })),
    sponsored,
  });
}
