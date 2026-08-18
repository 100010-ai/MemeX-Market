import { NextResponse } from "next/server";
import { requireLocalControl } from "@/lib/local-admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type PageResult<T> = { data: T[] | null; error: unknown };

async function fetchAll<T>(makePage: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const pageSize = 750;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await makePage(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const batch = result.data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

export async function GET(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = getSupabaseAdmin();
  try {
    const [profileRows, missionRows, coinRows, giftRows, auditRows, syncRunRows, catalogRunRows, catalogStateRows] = await Promise.all([
      fetchAll((from, to) =>
        supabase
          .from("profiles")
          .select("id,telegram_id,username,first_name,balance,xp,is_banned,ban_reason,banned_until,hidden_from_leaderboard,is_system,created_at")
          .order("created_at", { ascending: false })
          .range(from, to),
      ),
      fetchAll((from, to) =>
        supabase
          .from("missions")
          .select("id,key,period,title,description,reward,target,action_type,sort_order,active,updated_at")
          .order("period")
          .order("sort_order")
          .range(from, to),
      ),
      fetchAll((from, to) =>
        supabase
          .from("coins")
          .select("id,creator_profile_id,name,symbol,description,image_url,current_price,market_cap,status,hidden_from_market,created_at")
          .order("created_at", { ascending: false })
          .range(from, to),
      ),
      fetchAll((from, to) =>
        supabase
          .from("gift_market_overview")
          .select("virtual_gift_id,asset_id,telegram_name,base_name,gift_number,owner_profile_id,owner_name,status,listing_price,estimated_value,is_burned,created_at,catalog_source,telegram_resale_price_ton,resale_seen_at")
          .order("created_at", { ascending: false })
          .range(from, to),
      ),
      fetchAll((from, to) =>
        supabase
          .from("admin_audit_log")
          .select("id,actor,action,target_type,target_id,payload,created_at")
          .order("created_at", { ascending: false })
          .range(from, to),
      ),
      fetchAll((from, to) =>
        supabase
          .from("gift_sync_runs")
          .select("id,telegram_id,status,unique_imported,virtual_created,error_message,started_at,finished_at")
          .order("started_at", { ascending: false })
          .range(from, to),
      ),
      fetchAll((from, to) =>
        supabase
          .from("catalog_sync_runs")
          .select("id,source,status,reason,collections_scanned,resale_gifts_seen,assets_upserted,virtual_listings_created,media_objects_uploaded,skipped_without_ton_price,error_message,started_at,finished_at")
          .order("started_at", { ascending: false })
          .range(from, to),
      ),
      fetchAll((from, to) =>
        supabase
          .from("catalog_sync_state")
          .select("key,locked_until,last_started_at,last_finished_at,last_success_at,last_error,updated_at")
          .range(from, to),
      ),
    ]);

    return NextResponse.json({
      metrics: {
        players: profileRows.filter((row) => !row.is_system).length,
        banned: profileRows.filter((row) => !row.is_system && row.is_banned).length,
        hidden: profileRows.filter((row) => !row.is_system && row.hidden_from_leaderboard).length,
        coins: coinRows.length,
        activeCoins: coinRows.filter((row) => row.status === "active" && !row.hidden_from_market).length,
        gifts: giftRows.length,
        listedGifts: giftRows.filter((row) => row.status === "listed").length,
      },
      profiles: profileRows,
      missions: missionRows,
      coins: coinRows,
      gifts: giftRows,
      audit: auditRows,
      syncRuns: syncRunRows,
      catalogRuns: catalogRunRows,
      catalogState: catalogStateRows[0] || null,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("local control bootstrap", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить локальную админку" }, { status: 500 });
  }
}
