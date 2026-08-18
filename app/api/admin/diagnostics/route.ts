import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

async function countRows(table: string, configure?: (query: any) => any) {
  const supabase = getSupabaseAdmin();
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (configure) query = configure(query);
  const { count, error } = await query;
  if (error) throw error;
  return Number(count || 0);
}

export async function GET() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = getSupabaseAdmin();

  try {
    const [
      profiles,
      giftAssets,
      tradeableGiftAssets,
      missingGiftMedia,
      burnedGiftAssets,
      activeListings,
      pendingOffers,
      giftTrades,
      coinTrades,
      activeCoins,
      syncRunsResult,
    ] = await Promise.all([
      countRows("profiles"),
      countRows("gift_assets"),
      countRows("gift_assets", (q) => q.eq("is_burned", false)),
      countRows("gift_assets", (q) => q.or("telegram_name.is.null,model_file_id.is.null,symbol_file_id.is.null")),
      countRows("gift_assets", (q) => q.eq("is_burned", true)),
      countRows("virtual_gifts", (q) => q.eq("status", "listed")),
      countRows("gift_offers", (q) => q.eq("status", "pending")),
      countRows("gift_trades"),
      countRows("trades"),
      countRows("coins", (q) => q.eq("status", "active")),
      supabase
        .from("gift_sync_runs")
        .select("id,profile_id,telegram_id,status,pages_fetched,telegram_total_count,unique_received,unique_imported,assets_updated,virtual_created,error_message,started_at,finished_at,profiles(username,first_name)")
        .order("started_at", { ascending: false })
        .limit(20),
    ]);

    if (syncRunsResult.error) throw syncRunsResult.error;
    const syncRuns = (syncRunsResult.data || []).map((row: any) => {
      const person = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: String(row.id),
        profileId: String(row.profile_id),
        telegramId: Number(row.telegram_id),
        user: person?.username ? `@${person.username}` : person?.first_name || String(row.telegram_id),
        status: String(row.status),
        pagesFetched: Number(row.pages_fetched),
        telegramTotalCount: row.telegram_total_count == null ? null : Number(row.telegram_total_count),
        uniqueReceived: Number(row.unique_received),
        uniqueImported: Number(row.unique_imported),
        assetsUpdated: Number(row.assets_updated),
        virtualCreated: Number(row.virtual_created),
        errorMessage: row.error_message == null ? null : String(row.error_message),
        startedAt: String(row.started_at),
        finishedAt: row.finished_at == null ? null : String(row.finished_at),
      };
    });

    return NextResponse.json({
      metrics: {
        profiles,
        giftAssets,
        tradeableGiftAssets,
        missingGiftMedia,
        burnedGiftAssets,
        activeListings,
        pendingOffers,
        giftTrades,
        coinTrades,
        activeCoins,
      },
      syncRuns,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("admin diagnostics", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Diagnostics failed" }, { status: 500 });
  }
}
