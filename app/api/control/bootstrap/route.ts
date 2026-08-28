import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireLocalControl } from "@/lib/local-admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { inspectSchemaHealth } from "@/lib/schema-health";

export const runtime = "nodejs";

async function exactCount(table: string, configure?: (query: any) => any) {
  let query: any = getSupabaseAdmin().from(table).select("*", { head: true, count: "exact" });
  if (configure) query = configure(query);
  const result = await query;
  if (result.error) throw result.error;
  return Number(result.count || 0);
}

async function GETHandler(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = getSupabaseAdmin();
  try {
    const [
      profiles, missions, coins, gifts, audit, catalogSources, npcState, npcLog,
      systemProfiles, schemaHealth, liquidity,
      players, banned, hidden, coinCount, activeCoins, giftCount, listedGifts,
      activeSources, tonapiAssets, tonapiVerified,
    ] = await Promise.all([
      supabase.from("profiles").select("id,telegram_id,username,first_name,balance,xp,is_banned,ban_reason,banned_until,hidden_from_leaderboard,is_system,created_at").order("created_at", { ascending: false }).limit(350),
      supabase.from("missions").select("id,key,period,title,description,reward,target,action_type,sort_order,active,updated_at").order("period").order("sort_order").limit(400),
      supabase.from("coins").select("id,creator_profile_id,name,symbol,description,image_url,current_price,market_cap,status,hidden_from_market,created_at").order("created_at", { ascending: false }).limit(350),
      supabase.from("gift_market_overview").select("virtual_gift_id,asset_id,telegram_name,base_name,gift_number,owner_profile_id,owner_name,status,listing_price,estimated_value,is_burned,created_at,catalog_source,source_reference").order("created_at", { ascending: false }).limit(400),
      supabase.from("admin_audit_log").select("id,actor,action,target_type,target_id,payload,created_at").order("created_at", { ascending: false }).limit(300),
      supabase.from("gift_catalog_sources").select("id,telegram_id,label,active,last_synced_at,last_error,created_at,updated_at").order("created_at", { ascending: true }).limit(100),
      supabase.from("npc_market_state").select("key,locked_until,last_tick_at,last_success_at,last_error,cycle,updated_at").limit(10),
      supabase.from("npc_market_log").select("id,virtual_gift_id,asset_id,npc_profile_id,fair_price,listing_price,pricing_mode,rarity_score,created_at").order("created_at", { ascending: false }).limit(60),
      supabase.from("profiles").select("id").eq("is_system", true).limit(100),
      inspectSchemaHealth(supabase),
      supabase.rpc("gift_market_liquidity_state"),
      exactCount("profiles", q => q.eq("is_system", false)),
      exactCount("profiles", q => q.eq("is_system", false).eq("is_banned", true)),
      exactCount("profiles", q => q.eq("is_system", false).eq("hidden_from_leaderboard", true)),
      exactCount("coins"),
      exactCount("coins", q => q.eq("status", "active").eq("hidden_from_market", false)),
      exactCount("gift_market_overview"),
      exactCount("gift_market_overview", q => q.eq("status", "listed")),
      exactCount("gift_catalog_sources", q => q.eq("active", true)),
      exactCount("gift_assets", q => q.eq("catalog_source", "tonapi")),
      exactCount("gift_assets", q => q.eq("catalog_source", "tonapi").eq("chain_verified", true)),
    ]);

    const firstError = profiles.error || missions.error || coins.error || gifts.error || audit.error || catalogSources.error || npcState.error || npcLog.error || systemProfiles.error || liquidity.error;
    if (firstError) throw firstError;
    const systemIds = (systemProfiles.data || []).map(row => String(row.id));
    let npcListings = 0;
    if (systemIds.length) npcListings = await exactCount("virtual_gifts", q => q.eq("status", "listed").in("owner_profile_id", systemIds));

    return NextResponse.json({
      metrics: { players, banned, hidden, coins: coinCount, activeCoins, gifts: giftCount, listedGifts, npcListings, catalogSources: activeSources, tonapiAssets, tonapiVerified },
      profiles: profiles.data || [],
      missions: missions.data || [],
      coins: coins.data || [],
      gifts: gifts.data || [],
      audit: audit.data || [],
      catalogSources: catalogSources.data || [],
      npcState: npcState.data?.[0] || null,
      npcLog: npcLog.data || [],
      liquidity: liquidity.data || null,
      schemaHealth,
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("local control bootstrap", error);
    return apiFailure(error, "Не удалось загрузить локальную админку");
  }
}

export const GET = withApiErrors("app/api/control/bootstrap/route.ts:GET", GETHandler);
