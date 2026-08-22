import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RewardRow = {
  id: string;
  profile_id: string;
  reward: string | number;
  claimed_at: string | null;
  provider: string;
  verification_source: string | null;
};

function publicAlias(profileId: string) {
  const salt = String(process.env.REWARD_PROOF_SALT || process.env.SESSION_SECRET || "mxm-reward-proof-v1");
  return `MXM-${createHmac("sha256", salt).update(profileId).digest("hex").slice(0, 8).toUpperCase()}`;
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("rewarded_ad_sessions")
      .select("id,profile_id,reward,claimed_at,provider,verification_source")
      .eq("status", "claimed")
      .eq("provider", "adsgram")
      .eq("verification_source", "adsgram_server")
      .not("claimed_at", "is", null)
      .order("claimed_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const rows = (data || []) as RewardRow[];
    return NextResponse.json({
      available: true,
      generatedAt: new Date().toISOString(),
      disclaimer: "Это подтверждения внутриигровых начислений MXM после серверно подтверждённого просмотра AdsGram. Они не являются денежными выплатами или переводами Toncoin.",
      confirmations: rows.map((row) => ({
        id: String(row.id).slice(0, 8),
        user: publicAlias(String(row.profile_id)),
        reward: Number(row.reward),
        unit: "virtual_ton",
        provider: "AdsGram",
        verifiedBy: "server_callback",
        claimedAt: row.claimed_at,
      })),
    }, {
      headers: {
        "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (cause) {
    console.error("public reward confirmations", cause);
    return NextResponse.json({
      available: false,
      generatedAt: new Date().toISOString(),
      disclaimer: "История подтверждений временно недоступна. Денежных выплат или переводов Toncoin в MXM нет.",
      confirmations: [],
    }, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  }
}
