import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { tonApiHealth } from "@/lib/providers/tonapi-client";

export const runtime = "nodejs";

async function GETHandler() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const settings = await supabase.from("market_settings").select("external_quote_hours").eq("singleton", true).maybeSingle();
  const quoteHours = Math.max(1, Math.min(168, Number(settings.data?.external_quote_hours || 12)));
  const quoteCutoff = new Date(Date.now() - quoteHours * 60 * 60 * 1000).toISOString();
  const [catalogState, collections, assets, listed, quotedAssets, freshQuotedAssets] = await Promise.all([
    supabase.from("tonapi_catalog_state").select("last_sync_at,last_discovery_at,last_error,lock_until").eq("singleton", true).maybeSingle(),
    supabase.from("tonapi_gift_collections").select("address", { count: "exact", head: true }).eq("active", true),
    supabase.from("gift_assets").select("id", { count: "exact", head: true }).eq("is_burned", false),
    supabase.rpc("gift_market_listed_count"),
    supabase.from("gift_assets").select("id", { count: "exact", head: true }).not("telegram_resale_price_ton", "is", null),
    supabase.from("gift_assets").select("id", { count: "exact", head: true }).not("telegram_resale_price_ton", "is", null).gte("resale_seen_at", quoteCutoff),
  ]);

  const errors = [settings.error, catalogState.error, collections.error, assets.error, listed.error, quotedAssets.error, freshQuotedAssets.error].filter(Boolean);
  return NextResponse.json({
    ok: errors.length === 0,
    provider: { name: "tonapi", ...tonApiHealth() },
    catalog: {
      lastSyncAt: catalogState.data?.last_sync_at || null,
      lastDiscoveryAt: catalogState.data?.last_discovery_at || null,
      lastError: catalogState.data?.last_error || null,
      lockUntil: catalogState.data?.lock_until || null,
      activeCollections: collections.count || 0,
      verifiedAssets: assets.count || 0,
      listedGifts: Number(listed.data || 0),
      externalQuoteHours: quoteHours,
      quotedAssets: quotedAssets.count || 0,
      freshQuotedAssets: freshQuotedAssets.count || 0,
      staleQuotedAssets: Math.max(0, (quotedAssets.count || 0) - (freshQuotedAssets.count || 0)),
    },
    databaseErrors: errors.map((error) => error?.message || "database error").slice(0, 4),
  }, { headers: { "cache-control": "private, no-store" } });
}
export const GET = withApiErrors("app/api/system/market-health/route.ts:GET", GETHandler);
