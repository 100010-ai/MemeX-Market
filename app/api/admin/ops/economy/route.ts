import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { apiFailure, withApiErrors } from "@/lib/api-route";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

async function GETHandler() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  const { data, error } = await getSupabaseAdmin().from("economy_settings").select("coin_launch_fee,coin_launch_cooldown_hours,coin_max_active,gift_fee_bps,referral_bonus_bps,coin_total_fee_bps,creator_lock_bps,creator_lock_days,early_buyer_limit,coin_launch_energy_cost,updated_at").eq("singleton", true).single();
  if (error) return apiFailure(error, "Не удалось загрузить настройки экономики");
  return NextResponse.json({ economy: data }, { headers: { "cache-control": "private, no-store" } });
}

export const GET = withApiErrors("app/api/admin/ops/economy/route.ts:GET", GETHandler);
