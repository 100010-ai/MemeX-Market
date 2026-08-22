import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("creator_dashboard_v200", { p_profile_id: profile.id });
  if (error) return apiFailure(error, "Не удалось загрузить кабинет создателя");
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}
export const GET = withApiErrors("app/api/creator/route.ts:GET", GETHandler);
