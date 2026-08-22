import { withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getMarketActivity } from "@/lib/feed";

async function GETHandler(request: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const requested = Number(request.nextUrl.searchParams.get("limit") || 30);
  const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.floor(requested))) : 30;
  try {
    const activity = await getMarketActivity(getSupabaseAdmin(), limit);
    return NextResponse.json({ activity });
  } catch (error) {
    console.error("feed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить ленту рынка" }, { status: 500 });
  }
}
export const GET = withApiErrors("app/api/feed/route.ts:GET", GETHandler);
