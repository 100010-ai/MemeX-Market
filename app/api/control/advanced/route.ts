import { NextResponse } from "next/server";
import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { requireLocalControl } from "@/lib/local-admin";
import { sameOriginMutation, validUuidLike } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";

export const runtime = "nodejs";
const ACTOR = "local-control-center";
const DAY = 24 * 60 * 60 * 1000;
const MAX_BROADCAST_RECIPIENTS = 20_000;
const MAX_BULK_PROFILES = 100;

type JsonMap = Record<string, unknown>;
type EconomyDaily = { date?: string; emission?: number; burned?: number; net?: number };
type WashPair = { a?: string; b?: string; count?: number; volume?: number };
type Recipient = { profileId?: string; amount?: number };
type EconomyActivity = { daily?: EconomyDaily[]; washPairs?: WashPair[]; topRecipients?: Recipient[] };

function object(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}
function text(value: unknown, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function integer(value: unknown, min: number, max: number) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function safeHref(value: unknown) {
  const href = text(value, 300);
  return href && href.startsWith("/") && !href.startsWith("//") ? href : null;
}
async function audit(action: string, targetType = "system", targetId?: string, payload: JsonMap = {}) {
  const { error } = await getSupabaseAdmin().from("admin_audit_log").insert({
    actor: ACTOR,
    action,
    target_type: targetType,
    target_id: targetId || null,
    payload,
  });
  if (error) console.error("advanced control audit", error);
}
async function fetchAllIds(makePage: (from: number, to: number) => PromiseLike<{ data: Array<{ id?: string; profile_id?: string }> | null; error: unknown }>, cap = MAX_BROADCAST_RECIPIENTS) {
  const ids: string[] = [];
  const pageSize = 750;
  for (let from = 0; from < cap; from += pageSize) {
    const result = await makePage(from, Math.min(cap - 1, from + pageSize - 1));
    if (result.error) throw result.error;
    const rows = result.data || [];
    for (const row of rows) {
      const id = String(row.id || row.profile_id || "");
      if (validUuidLike(id)) ids.push(id);
    }
    if (rows.length < pageSize) break;
  }
  return [...new Set(ids)].slice(0, cap);
}
async function resolveAudience(audience: string) {
  const supabase = getSupabaseAdmin();
  if (audience === "active7d") {
    const cutoff = new Date(Date.now() - 7 * DAY).toISOString();
    const present = await fetchAllIds((from, to) => supabase.from("profile_presence_v067")
      .select("profile_id").gte("last_seen_at", cutoff).order("last_seen_at", { ascending: false }).range(from, to));
    if (!present.length) return [];
    const profiles = await supabase.from("profiles").select("id").in("id", present).eq("is_system", false).eq("is_banned", false).limit(MAX_BROADCAST_RECIPIENTS);
    if (profiles.error) throw profiles.error;
    return (profiles.data || []).map((row) => String(row.id));
  }
  if (audience === "stars") {
    return fetchAllIds((from, to) => supabase.from("profiles").select("id")
      .eq("is_system", false).eq("is_banned", false).gt("stars_spent", 0).order("stars_spent", { ascending: false }).range(from, to));
  }
  return fetchAllIds((from, to) => supabase.from("profiles").select("id")
    .eq("is_system", false).eq("is_banned", false).order("created_at", { ascending: false }).range(from, to));
}

async function GETHandler(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = getSupabaseAdmin();
  try {
    const since90d = new Date(Date.now() - 90 * DAY).toISOString();
    const [stars, cases, loot, seasons, rewards, economyOverview, economyActivity, broadcasts] = await Promise.all([
      supabase.from("star_purchases")
        .select("id,profile_id,stars,status,product_sku,paid_at,created_at,updated_at,refunded_at,refund_reason,expires_at,telegram_payment_charge_id,payer_telegram_id")
        .gte("created_at", since90d).order("created_at", { ascending: false }).limit(250),
      supabase.from("case_definitions")
        .select("sku,title,tier,description,remaining_supply,active,rare_pity,epic_pity,legendary_pity").order("tier").order("sku"),
      supabase.from("case_loot_definitions")
        .select("id,case_sku,reward_key,reward_kind,reward_label,amount,weight,rarity,metadata,active").order("case_sku").order("weight", { ascending: false }).limit(1500),
      supabase.from("seasons")
        .select("id,season_key,title,starts_at,ends_at,active,created_at,week_number,metadata").order("starts_at", { ascending: false }).limit(40),
      supabase.from("season_rewards")
        .select("season_id,level,track,required_xp,reward_kind,reward_label,amount,metadata").order("season_id").order("level").limit(2000),
      supabase.rpc("admin_economy_overview_v028"),
      supabase.rpc("admin_economy_activity_v028"),
      supabase.from("admin_audit_log").select("id,action,payload,created_at")
        .eq("action", "broadcast.send").order("created_at", { ascending: false }).limit(12),
    ]);
    const firstError = stars.error || cases.error || loot.error || seasons.error || rewards.error || economyOverview.error || economyActivity.error || broadcasts.error;
    if (firstError) throw firstError;

    const profileIds = [...new Set((stars.data || []).map((row) => String(row.profile_id)).filter(validUuidLike))];
    const activity = object(economyActivity.data) as EconomyActivity;
    const washPairs = Array.isArray(activity.washPairs) ? activity.washPairs : [];
    const topRecipients = Array.isArray(activity.topRecipients) ? activity.topRecipients : [];
    const riskIds = [...new Set([
      ...washPairs.flatMap((row) => [String(row.a || ""), String(row.b || "")]),
      ...topRecipients.map((row) => String(row.profileId || "")),
    ].filter(validUuidLike))];
    const allPeopleIds = [...new Set([...profileIds, ...riskIds])];
    const people = allPeopleIds.length
      ? await supabase.from("profiles").select("id,telegram_id,username,first_name,is_banned,hidden_from_leaderboard,balance,mxm_coins,stars_spent,vip_points,created_at").in("id", allPeopleIds)
      : { data: [], error: null };
    if (people.error) throw people.error;
    const peopleMap = new Map((people.data || []).map((row) => [String(row.id), row]));

    const starSummary = { paid: 0, refunded: 0, pending: 0, expired: 0, paidStars: 0, refundedStars: 0, pendingStars: 0 };
    for (const row of stars.data || []) {
      const status = String(row.status || "");
      const amount = Number(row.stars || 0);
      if (status === "paid") { starSummary.paid += 1; starSummary.paidStars += amount; }
      else if (status === "refunded") { starSummary.refunded += 1; starSummary.refundedStars += amount; }
      else if (status === "pending") { starSummary.pending += 1; starSummary.pendingStars += amount; }
      else if (status === "expired") starSummary.expired += 1;
    }

    const lootByCase = new Map<string, Array<JsonMap>>();
    for (const row of loot.data || []) {
      const key = String(row.case_sku);
      const list = lootByCase.get(key) || [];
      list.push(row as unknown as JsonMap);
      lootByCase.set(key, list);
    }
    const caseRows = (cases.data || []).map((row) => {
      const items = lootByCase.get(String(row.sku)) || [];
      const activeItems = items.filter((item) => item.active !== false);
      const totalWeight = activeItems.reduce((sum, item) => sum + Number(item.weight || 0), 0);
      return {
        ...row,
        totalWeight,
        loot: items.map((item) => ({ ...item, chance: totalWeight > 0 && item.active !== false ? Number(item.weight || 0) / totalWeight : 0 })),
      };
    });

    const rewardsBySeason = new Map<string, Array<JsonMap>>();
    for (const row of rewards.data || []) {
      const key = String(row.season_id);
      const list = rewardsBySeason.get(key) || [];
      list.push(row as unknown as JsonMap);
      rewardsBySeason.set(key, list);
    }
    const seasonRows = (seasons.data || []).map((row) => {
      const items = rewardsBySeason.get(String(row.id)) || [];
      return { ...row, rewards: items, rewardCount: items.length, maxLevel: Math.max(0, ...items.map((item) => Number(item.level || 0))) };
    });

    const risks = washPairs.map((row) => {
      const a = String(row.a || "");
      const b = String(row.b || "");
      const count = Number(row.count || 0);
      const volume = Number(row.volume || 0);
      const score = Math.min(100, Math.round(count * 6 + Math.log10(Math.max(1, volume)) * 14));
      return { a, b, count, volume, score, aProfile: peopleMap.get(a) || null, bProfile: peopleMap.get(b) || null };
    }).sort((x, y) => y.score - x.score || y.volume - x.volume);

    return NextResponse.json({
      stars: {
        summary: starSummary,
        purchases: (stars.data || []).map((row) => ({ ...row, profile: peopleMap.get(String(row.profile_id)) || null })),
      },
      economy: {
        metrics: economyOverview.data || {},
        daily: Array.isArray(activity.daily) ? activity.daily : [],
        topRecipients: topRecipients.map((row) => ({ ...row, profile: peopleMap.get(String(row.profileId || "")) || null })),
      },
      cases: caseRows,
      seasons: seasonRows,
      risks,
      broadcasts: broadcasts.data || [],
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error, "Не удалось загрузить Advanced Control");
  }
}

async function POSTHandler(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = text(body.action, 80);
  const supabase = getSupabaseAdmin();
  try {
    if (action === "broadcast.send") {
      const audience = ["all", "active7d", "stars"].includes(String(body.audience)) ? String(body.audience) : "all";
      const title = text(body.title, 90);
      const message = text(body.body, 600);
      const href = safeHref(body.href);
      if (title.length < 2 || message.length < 2) return NextResponse.json({ error: "Заполните заголовок и текст рассылки" }, { status: 400 });
      const ids = await resolveAudience(audience);
      if (!ids.length) return NextResponse.json({ error: "Для выбранной аудитории нет получателей" }, { status: 409 });
      const broadcastId = crypto.randomUUID();
      let inserted = 0;
      for (let offset = 0; offset < ids.length; offset += 500) {
        const batch = ids.slice(offset, offset + 500).map((profileId) => ({
          profile_id: profileId,
          kind: "system",
          title,
          body: message,
          href,
          metadata: { source: "control_broadcast", audience, broadcastId },
          dedupe_key: `control-broadcast:${broadcastId}:${profileId}`,
        }));
        const result = await supabase.from("user_notifications").insert(batch);
        if (result.error) throw result.error;
        inserted += batch.length;
      }
      await audit("broadcast.send", "notification", broadcastId, { audience, title, href, recipients: inserted });
      return NextResponse.json({ ok: true, broadcastId, recipients: inserted });
    }

    if (action === "profiles.bulk_moderate") {
      const ids = Array.isArray(body.profileIds) ? [...new Set(body.profileIds.map((value) => String(value)).filter(validUuidLike))].slice(0, MAX_BULK_PROFILES) : [];
      if (!ids.length) return NextResponse.json({ error: "Не выбраны профили" }, { status: 400 });
      const patch: JsonMap = { updated_at: new Date().toISOString() };
      if (typeof body.isBanned === "boolean") {
        patch.is_banned = body.isBanned;
        if (!body.isBanned) { patch.ban_reason = null; patch.banned_until = null; }
        else patch.ban_reason = text(body.reason, 300) || "Bulk moderation";
      }
      if (typeof body.hiddenFromLeaderboard === "boolean") patch.hidden_from_leaderboard = body.hiddenFromLeaderboard;
      if (Object.keys(patch).length === 1) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const result = await supabase.from("profiles").update(patch).in("id", ids).eq("is_system", false).select("id");
      if (result.error) throw result.error;
      const changed = result.data || [];
      await audit("profiles.bulk_moderate", "profile_batch", undefined, { requested: ids.length, changed: changed.length, isBanned: body.isBanned, hiddenFromLeaderboard: body.hiddenFromLeaderboard });
      return NextResponse.json({ ok: true, changed: changed.length });
    }

    if (action === "case.update") {
      const sku = text(body.sku, 100);
      if (!sku) return NextResponse.json({ error: "Кейс не выбран" }, { status: 400 });
      const patch: JsonMap = {};
      if (typeof body.active === "boolean") patch.active = body.active;
      if (body.remainingSupply !== undefined) {
        const value = integer(body.remainingSupply, 0, 10_000_000);
        if (value == null) return NextResponse.json({ error: "Некорректный remaining supply" }, { status: 400 });
        patch.remaining_supply = value;
      }
      for (const [input, column] of [["rarePity", "rare_pity"], ["epicPity", "epic_pity"], ["legendaryPity", "legendary_pity"]] as const) {
        if (body[input] !== undefined) {
          const value = integer(body[input], 0, 100_000);
          if (value == null) return NextResponse.json({ error: `Некорректное значение ${input}` }, { status: 400 });
          patch[column] = value;
        }
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const result = await supabase.from("case_definitions").update(patch).eq("sku", sku).select("sku").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return NextResponse.json({ error: "Кейс не найден" }, { status: 404 });
      await audit("case.update", "case", sku, patch);
      return NextResponse.json({ ok: true });
    }

    if (action === "case.loot.update") {
      const lootId = text(body.lootId, 80);
      if (!validUuidLike(lootId)) return NextResponse.json({ error: "Некорректный loot ID" }, { status: 400 });
      const patch: JsonMap = {};
      if (typeof body.active === "boolean") patch.active = body.active;
      if (body.weight !== undefined) {
        const value = integer(body.weight, 0, 10_000_000);
        if (value == null) return NextResponse.json({ error: "Некорректный weight" }, { status: 400 });
        patch.weight = value;
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const result = await supabase.from("case_loot_definitions").update(patch).eq("id", lootId).select("id,case_sku").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return NextResponse.json({ error: "Loot не найден" }, { status: 404 });
      await audit("case.loot.update", "case_loot", lootId, { ...patch, caseSku: result.data.case_sku });
      return NextResponse.json({ ok: true });
    }

    if (action === "season.update") {
      const seasonId = text(body.seasonId, 80);
      if (!validUuidLike(seasonId)) return NextResponse.json({ error: "Некорректный season ID" }, { status: 400 });
      const patch: JsonMap = {};
      if (body.title !== undefined) {
        const title = text(body.title, 120);
        if (title.length < 2) return NextResponse.json({ error: "Название сезона слишком короткое" }, { status: 400 });
        patch.title = title;
      }
      if (body.weekNumber !== undefined) {
        const value = integer(body.weekNumber, 1, 60);
        if (value == null) return NextResponse.json({ error: "Некорректный номер недели" }, { status: 400 });
        patch.week_number = value;
      }
      const startsAt = body.startsAt !== undefined ? new Date(String(body.startsAt)) : null;
      const endsAt = body.endsAt !== undefined ? new Date(String(body.endsAt)) : null;
      if (startsAt && Number.isNaN(startsAt.getTime())) return NextResponse.json({ error: "Некорректная дата начала" }, { status: 400 });
      if (endsAt && Number.isNaN(endsAt.getTime())) return NextResponse.json({ error: "Некорректная дата окончания" }, { status: 400 });
      if (startsAt) patch.starts_at = startsAt.toISOString();
      if (endsAt) patch.ends_at = endsAt.toISOString();
      if (typeof body.active === "boolean") patch.active = body.active;
      if (!Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      if (patch.active === true) {
        const disable = await supabase.from("seasons").update({ active: false }).neq("id", seasonId).eq("active", true);
        if (disable.error) throw disable.error;
      }
      const result = await supabase.from("seasons").update(patch).eq("id", seasonId).select("id,title,active").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return NextResponse.json({ error: "Сезон не найден" }, { status: 404 });
      await audit("season.update", "season", seasonId, patch);
      return NextResponse.json({ ok: true, season: result.data });
    }

    if (action === "stars.refund") {
      const purchaseId = text(body.purchaseId, 80);
      const reason = text(body.reason, 300) || "Admin refund";
      if (!validUuidLike(purchaseId)) return NextResponse.json({ error: "Некорректный purchase ID" }, { status: 400 });
      const purchase = await supabase.from("star_purchases")
        .select("id,profile_id,status,stars,telegram_payment_charge_id,payer_telegram_id,refunded_at")
        .eq("id", purchaseId).maybeSingle();
      if (purchase.error) throw purchase.error;
      if (!purchase.data) return NextResponse.json({ error: "Покупка не найдена" }, { status: 404 });
      if (purchase.data.status === "refunded") {
        const reversal = await supabase.rpc("reverse_star_purchase_fulfillment_v074", { p_purchase_id: purchaseId });
        if (reversal.error) throw reversal.error;
        return NextResponse.json({ ok: true, alreadyRefunded: true, reversal: reversal.data });
      }
      if (purchase.data.status !== "paid") return NextResponse.json({ error: `Возврат доступен только для paid, сейчас ${purchase.data.status}` }, { status: 409 });
      const chargeId = String(purchase.data.telegram_payment_charge_id || "");
      let payerId = Number(purchase.data.payer_telegram_id || 0);
      if (!Number.isSafeInteger(payerId) || payerId <= 0) {
        const profile = await supabase.from("profiles").select("telegram_id").eq("id", purchase.data.profile_id).maybeSingle();
        if (profile.error) throw profile.error;
        payerId = Number(profile.data?.telegram_id || 0);
      }
      if (!chargeId || !Number.isSafeInteger(payerId) || payerId <= 0) return NextResponse.json({ error: "У покупки нет Telegram charge ID или payer ID" }, { status: 409 });

      await telegramBotApi<boolean>("refundStarPayment", { user_id: payerId, telegram_payment_charge_id: chargeId });
      const transition = await supabase.rpc("mark_star_purchase_refunded_v200", {
        p_purchase_id: purchaseId,
        p_charge_id: chargeId,
        p_reason: reason,
        p_metadata: { source: "local_control", operator: ACTOR },
      });
      if (transition.error) throw transition.error;
      const reversal = await supabase.rpc("reverse_star_purchase_fulfillment_v074", { p_purchase_id: purchaseId });
      if (reversal.error) throw reversal.error;
      await audit("stars.refund", "star_purchase", purchaseId, { stars: Number(purchase.data.stars || 0), payerId, reason, transition: transition.data, reversal: reversal.data });
      return NextResponse.json({ ok: true, transition: transition.data, reversal: reversal.data });
    }

    return NextResponse.json({ error: "Неизвестная Advanced операция" }, { status: 400 });
  } catch (error) {
    return apiFailure(error, "Advanced операция не выполнена", 400);
  }
}

export const GET = withApiErrors("app/api/control/advanced/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/control/advanced/route.ts:POST", POSTHandler);
