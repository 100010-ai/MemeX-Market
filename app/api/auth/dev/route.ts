import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { setSession } from "@/lib/session";
import { getProfileSnapshot } from "@/lib/auth";

export const runtime = "nodejs";

async function POSTHandler() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_AUTH_ENABLED !== "true") {
    return NextResponse.json({ error: "Авторизация разработчика отключена" }, { status: 403 });
  }
  try {
    const telegramId = Number(process.env.DEV_TELEGRAM_ID || 900000001);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("sync_telegram_profile", {
      p_telegram_id: telegramId,
      p_username: process.env.DEV_TELEGRAM_USERNAME || "dev_trader",
      p_first_name: process.env.DEV_TELEGRAM_FIRST_NAME || "Dev",
      p_last_name: null,
      p_photo_url: null,
    });
    if (error || !data) throw error || new Error("Could not create dev profile");
    await setSession(telegramId);
    return NextResponse.json({ profile: await getProfileSnapshot(data) });
  } catch (error) {
    console.error("dev auth", error);
    return apiFailure(error, "Не удалось выполнить авторизацию разработчика");
  }
}
export const POST = withApiErrors("app/api/auth/dev/route.ts:POST", POSTHandler);
