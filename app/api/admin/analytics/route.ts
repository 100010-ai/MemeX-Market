import { NextResponse } from "next/server";
import { apiFailure, withApiErrors } from "@/lib/api-route";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function analyticsPeriod(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get("days") || 30);
  return raw === 7 || raw === 90 ? raw : 30;
}

async function GETHandler(request: Request) {
  const admin = await requireAdminProfile("analytics.read");
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  const period = analyticsPeriod(request);
  try {
    const supabase = getSupabaseAdmin();
    const [analyticsResult, funnelResult] = await Promise.all([
      supabase.rpc("admin_analytics_v067", { p_days: period }),
      supabase.rpc("admin_funnel_v067", { p_days: period }),
    ]);
    if (analyticsResult.error || funnelResult.error) throw analyticsResult.error || funnelResult.error;
    const analytics = analyticsResult.data && typeof analyticsResult.data === "object" && !Array.isArray(analyticsResult.data)
      ? analyticsResult.data as Record<string, unknown>
      : {};
    return NextResponse.json({
      analytics: { ...analytics, funnel: Array.isArray(funnelResult.data) ? funnelResult.data : [] },
      generatedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error, "Не удалось собрать продуктовую аналитику");
  }
}

export const GET = withApiErrors("app/api/admin/analytics/route.ts:GET", GETHandler);
