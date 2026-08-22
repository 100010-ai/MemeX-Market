import { withApiErrors } from "@/lib/api-route";
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

async function GETHandler(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = getSupabaseAdmin();
  try {
    const [profileRows, missionRows, coinRows, giftRows, auditRows, sourceRows, npcStateRows, npcLogRows] = await Promise.all([
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
          .select("virtual_gift_id,asset_id,telegram_name,base_name,gift_number,owner_profile_id,owner_name,status,listing_price,estimated_value,is_burned,created_at,catalog_source,source_reference")
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
          .from("gift_catalog_sources")
          .select("id,telegram_id,label,active,last_synced_at,last_error,created_at,updated_at")
          .order("created_at", { ascending: true })
          .range(from, to),
      ),
      fetchAll((from, to) =>
        supabase
          .from("npc_market_state")
          .select("key,locked_until,last_tick_at,last_success_at,last_error,cycle,updated_at")
          .range(from, to),
      ),
      supabase
        .from("npc_market_log")
        .select("id,virtual_gift_id,asset_id,npc_profile_id,fair_price,listing_price,pricing_mode,rarity_score,created_at")
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

    const [tonapiCountResult, tonapiVerifiedResult, tonapiStateResult] = await Promise.all([
      supabase.from("gift_assets").select("id", { head: true, count: "exact" }).eq("catalog_source", "tonapi"),
      supabase.from("gift_assets").select("id", { head: true, count: "exact" }).eq("catalog_source", "tonapi").eq("chain_verified", true),
      supabase.from("tonapi_catalog_state").select("last_discovery_at,last_sync_at,last_error,lock_until,updated_at").eq("singleton", true).maybeSingle(),
    ]);
    if (tonapiCountResult.error) throw tonapiCountResult.error;
    if (tonapiVerifiedResult.error) throw tonapiVerifiedResult.error;
    if (tonapiStateResult.error) throw tonapiStateResult.error;

    const systemIds = new Set(profileRows.filter((row) => row.is_system).map((row) => String(row.id)));
    return NextResponse.json({
      metrics: {
        players: profileRows.filter((row) => !row.is_system).length,
        banned: profileRows.filter((row) => !row.is_system && row.is_banned).length,
        hidden: profileRows.filter((row) => !row.is_system && row.hidden_from_leaderboard).length,
        coins: coinRows.length,
        activeCoins: coinRows.filter((row) => row.status === "active" && !row.hidden_from_market).length,
        gifts: giftRows.length,
        listedGifts: giftRows.filter((row) => row.status === "listed").length,
        npcListings: giftRows.filter((row) => row.status === "listed" && systemIds.has(String(row.owner_profile_id))).length,
        catalogSources: sourceRows.filter((row) => row.active).length,
        tonapiAssets: tonapiCountResult.count || 0,
        tonapiVerified: tonapiVerifiedResult.count || 0,
      },
      profiles: profileRows,
      missions: missionRows,
      coins: coinRows,
      gifts: giftRows,
      audit: auditRows,
      catalogSources: sourceRows,
      npcState: npcStateRows[0] || null,
      npcLog: npcLogRows.data || [],
      tonapiState: tonapiStateResult.data || null,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("local control bootstrap", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить локальную админку" }, { status: 500 });
  }
}
export const GET = withApiErrors("app/api/control/bootstrap/route.ts:GET", GETHandler);
