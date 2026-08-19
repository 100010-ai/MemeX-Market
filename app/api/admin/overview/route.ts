import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type PageResult<T> = { data: T[] | null; error: unknown };

function missingOptionalTable(error: { code?: string; message?: string } | null | undefined, names: string[]) {
  return Boolean(error && (error.code === "42P01" || names.some((name) => new RegExp(`${name}|schema cache`, "i").test(error.message || ""))));
}

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

export async function GET() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
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

    const [sponsorCampaignResult, sponsorClaimsResult, promoCodesResult] = await Promise.all([
      supabase.from("sponsored_campaigns").select("id,advertiser_name,title,description,instructions,verification_type,target_url,telegram_chat_id,button_label,reward,max_completions,completed_count,status,starts_at,ends_at,priority,featured,internal_note,created_by,created_at,updated_at").order("created_at", { ascending: false }).limit(500),
      supabase.from("sponsored_task_claims").select("id,campaign_id,profile_id,status,opened_at,submitted_at,verified_at,claimed_at,verification_source,reviewed_by,metadata,created_at,updated_at").order("created_at", { ascending: false }).limit(5000),
      supabase.from("promo_codes").select("id,code,reward,max_uses,uses_count,active,starts_at,ends_at,note,created_by,created_at,updated_at").order("created_at", { ascending: false }).limit(500),
    ]);
    if (sponsorCampaignResult.error && !missingOptionalTable(sponsorCampaignResult.error, ["sponsored_campaigns"])) throw sponsorCampaignResult.error;
    if (sponsorClaimsResult.error && !missingOptionalTable(sponsorClaimsResult.error, ["sponsored_task_claims"])) throw sponsorClaimsResult.error;
    if (promoCodesResult.error && !missingOptionalTable(promoCodesResult.error, ["promo_codes"])) throw promoCodesResult.error;
    const sponsoredCampaigns = sponsorCampaignResult.data || [];
    const sponsoredClaims = sponsorClaimsResult.data || [];
    const promoCodes = promoCodesResult.data || [];

    const dayStart = new Date(); dayStart.setUTCHours(0,0,0,0);
    const [tonapiCountResult, tonapiVerifiedResult, tonapiStateResult, economyResult, rewardedTodayResult, economyEventsTodayResult] = await Promise.all([
      supabase.from("gift_assets").select("id", { head: true, count: "exact" }).eq("catalog_source", "tonapi"),
      supabase.from("gift_assets").select("id", { head: true, count: "exact" }).eq("catalog_source", "tonapi").eq("chain_verified", true),
      supabase.from("tonapi_catalog_state").select("last_discovery_at,last_sync_at,last_error,lock_until,updated_at").eq("singleton", true).maybeSingle(),
      supabase.from("economy_settings").select("rewarded_ad_reward,rewarded_ad_daily_limit,rewarded_ad_cooldown_minutes,coin_launch_fee,coin_launch_cooldown_hours,coin_max_active,gift_fee_bps,updated_at").eq("singleton", true).maybeSingle(),
      supabase.from("rewarded_ad_sessions").select("id", { head: true, count: "exact" }).eq("status", "claimed").gte("claimed_at", dayStart.toISOString()),
      supabase.from("economy_events").select("kind,amount").gte("created_at", dayStart.toISOString()).limit(5000),
    ]);
    if (tonapiCountResult.error) throw tonapiCountResult.error;
    if (tonapiVerifiedResult.error) throw tonapiVerifiedResult.error;
    if (tonapiStateResult.error) throw tonapiStateResult.error;
    const economyMissing = economyResult.error && (economyResult.error.code === "42P01" || /economy_settings|schema cache/i.test(economyResult.error.message || ""));
    if (economyResult.error && !economyMissing) throw economyResult.error;
    const rewardedMissing = rewardedTodayResult.error && (rewardedTodayResult.error.code === "42P01" || /rewarded_ad_sessions|schema cache/i.test(rewardedTodayResult.error.message || ""));
    if (rewardedTodayResult.error && !rewardedMissing) throw rewardedTodayResult.error;
    const economyEventsMissing = economyEventsTodayResult.error && (economyEventsTodayResult.error.code === "42P01" || /economy_events|schema cache/i.test(economyEventsTodayResult.error.message || ""));
    if (economyEventsTodayResult.error && !economyEventsMissing) throw economyEventsTodayResult.error;
    const economyEvents = (economyEventsTodayResult.data || []) as Array<{ kind: string; amount: number | string }>;
    const emissionToday = economyEvents.reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
    const sinksToday = economyEvents.reduce((sum, row) => sum + Math.max(0, -Number(row.amount || 0)), 0);
    const adsEmissionToday = economyEvents.filter((row) => row.kind === "rewarded_ad").reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
    const missionEmissionToday = economyEvents.filter((row) => row.kind === "mission").reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
    const launchSinkToday = economyEvents.filter((row) => row.kind === "coin_launch").reduce((sum, row) => sum + Math.max(0, -Number(row.amount || 0)), 0);
    const tradeFeeSinkToday = economyEvents.filter((row) => row.kind === "coin_trade_fee").reduce((sum, row) => sum + Math.max(0, -Number(row.amount || 0)), 0);
    const sponsoredEmissionToday = economyEvents.filter((row) => row.kind === "sponsored_task").reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
    const promoEmissionToday = economyEvents.filter((row) => row.kind === "promo_code").reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);

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
        totalPlayerBalance: profileRows.filter((row) => !row.is_system).reduce((sum, row) => sum + Number(row.balance || 0), 0),
        totalXp: profileRows.filter((row) => !row.is_system).reduce((sum, row) => sum + Number(row.xp || 0), 0),
        systemAccounts: profileRows.filter((row) => row.is_system).length,
        newPlayers24h: profileRows.filter((row) => !row.is_system && Date.now() - new Date(row.created_at).getTime() < 86400000).length,
        newCoins24h: coinRows.filter((row) => Date.now() - new Date(row.created_at).getTime() < 86400000).length,
        newGifts24h: giftRows.filter((row) => Date.now() - new Date(row.created_at).getTime() < 86400000).length,
        listedValue: giftRows.filter((row) => row.status === "listed").reduce((sum, row) => sum + Number(row.listing_price || 0), 0),
        activeSponsoredCampaigns: sponsoredCampaigns.filter((row) => row.status === "active").length,
        pendingSponsoredChecks: sponsoredClaims.filter((row) => row.status === "pending").length,
        sponsoredClaimsToday: sponsoredClaims.filter((row) => row.status === "claimed" && row.claimed_at && Date.now() - new Date(row.claimed_at).getTime() < 86400000).length,
        promoUsesTotal: promoCodes.reduce((sum, row) => sum + Number(row.uses_count || 0), 0),
        rewardedAdsToday: rewardedTodayResult.count || 0,
        economyEmissionToday: emissionToday,
        economySinksToday: sinksToday,
        economyNetToday: emissionToday - sinksToday,
        adsEmissionToday,
        missionEmissionToday,
        launchSinkToday,
        tradeFeeSinkToday,
        sponsoredEmissionToday,
        promoEmissionToday,
      },
      economy: economyResult.data || null,
      profiles: profileRows,
      missions: missionRows,
      coins: coinRows,
      gifts: giftRows,
      audit: auditRows,
      catalogSources: sourceRows,
      npcState: npcStateRows[0] || null,
      npcLog: npcLogRows.data || [],
      tonapiState: tonapiStateResult.data || null,
      sponsoredCampaigns,
      sponsoredClaims,
      promoCodes,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("admin overview", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить админ-панель" }, { status: 500 });
  }
}
