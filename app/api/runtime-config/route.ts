import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRuntimeConfig } from "@/lib/runtime-config";

async function GETHandler() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  try {
    return NextResponse.json({ config: await getRuntimeConfig() }, {
      headers: { "cache-control": "private, max-age=15, stale-while-revalidate=30" },
    });
  } catch (error) {
    return apiFailure(error, "Не удалось загрузить конфигурацию приложения");
  }
}
export const GET = withApiErrors("app/api/runtime-config/route.ts:GET", GETHandler);
