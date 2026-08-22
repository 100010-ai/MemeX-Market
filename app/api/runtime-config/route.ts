import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getRuntimeConfig } from "@/lib/runtime-config";

async function GETHandler() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ config: await getRuntimeConfig() }, {
      headers: { "cache-control": "private, max-age=15, stale-while-revalidate=30" },
    });
  } catch (error) {
    console.error("runtime config", error);
    return NextResponse.json({ error: "Не удалось загрузить конфигурацию приложения" }, { status: 500 });
  }
}
export const GET = withApiErrors("app/api/runtime-config/route.ts:GET", GETHandler);
