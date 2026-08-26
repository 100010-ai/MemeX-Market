import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type CountFilter =
  | { kind: "eq"; column: string; value: string | number | boolean }
  | { kind: "or"; expression: string };

type SyncRunRow = {
  id: unknown;
  profile_id: unknown;
  telegram_id: unknown;
  status: unknown;
  pages_fetched: unknown;
  telegram_total_count: unknown;
  unique_received: unknown;
  unique_imported: unknown;
  skipped_invalid: unknown;
  assets_updated: unknown;
  virtual_created: unknown;
  error_message: unknown;
  started_at: unknown;
  finished_at: unknown;
  profiles: { username?: unknown; first_name?: unknown } | Array<{ username?: unknown; first_name?: unknown }> | null;
};

async function countRows(table: string, filter?: CountFilter) {
  const supabase = getSupabaseAdmin();
  const baseQuery = () => supabase.from(table).select("id", { count: "exact", head: true });
  const result = filter?.kind === "eq"
    ? await baseQuery().eq(filter.column, filter.value)
    : filter?.kind === "or"
      ? await baseQuery().or(filter.expression)
      : await baseQuery();
  if (result.error) throw result.error;
  return Number(result.count || 0);
}

async function GETHandler() {
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
      countRows("gift_assets", { kind: "eq", column: "is_burned", value: false }),
      countRows("gift_assets", { kind: "or", expression: "telegram_name.is.null,model_file_id.is.null,symbol_file_id.is.null" }),
      countRows("gift_assets", { kind: "eq", column: "is_burned", value: true }),
      countRows("virtual_gifts", { kind: "eq", column: "status", value: "listed" }),
      countRows("gift_offers", { kind: "eq", column: "status", value: "pending" }),
      countRows("gift_trades"),
      countRows("trades"),
      countRows("coins", { kind: "eq", column: "status", value: "active" }),
      supabase
        .from("gift_sync_runs")
        .select("id,profile_id,telegram_id,status,pages_fetched,telegram_total_count,unique_received,unique_imported,skipped_invalid,assets_updated,virtual_created,error_message,started_at,finished_at,profiles(username,first_name)")
        .order("started_at", { ascending: false })
        .limit(20),
    ]);

    if (syncRunsResult.error) throw syncRunsResult.error;
    const syncRuns = (syncRunsResult.data || []).map((raw) => {
      const row = raw as unknown as SyncRunRow;
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
        skippedInvalid: Number(row.skipped_invalid),
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
    return apiFailure(error, "Diagnostics failed");
  }
}
export const GET = withApiErrors("app/api/admin/diagnostics/route.ts:GET", GETHandler);
