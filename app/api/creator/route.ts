import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("creator_dashboard_v200", { p_profile_id: profile.id });
  if (error) {
    const missing = error.code === "42883" || /creator_dashboard_v200|schema cache|could not find the function/i.test(error.message || "");
    console.error("creator dashboard", error);
    return NextResponse.json({ error: missing ? "Примените миграцию Market Economy 2.0" : "Не удалось загрузить кабинет создателя" }, { status: missing ? 503 : 500 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}
