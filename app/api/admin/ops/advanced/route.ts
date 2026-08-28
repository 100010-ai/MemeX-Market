import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";

export const runtime = "nodejs";
const DAY = 86_400_000;
const MAX_BULK = 100;

type JsonMap = Record<string, unknown>;
type EconomyActivity = {
  daily?: Array<{ date?: string; emission?: number; burned?: number; net?: number }>;
  washPairs?: Array<{ a?: string; b?: string; count?: number; volume?: number }>;
  topRecipients?: Array<{ profileId?: string; amount?: number }>;
};

function object(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}
function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}
function int(value: unknown, min: number, max: number) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
async function audit(actor: string, action: string, targetType?: string, targetId?: string, payload: JsonMap = {}) {
  const { error } = await getSupabaseAdmin().from("admin_audit_log").insert({
    actor,
    action,
    target_type: targetType || null,
    target_id: targetId || null,
    payload,
  });
  if (error) console.error("advanced admin audit", error);
}

async function GETHandler() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  const supabase = getSupabaseAdmin();
  try {
    const since90d = new Date(Date.now() - 90 * DAY).toISOString();
    const [stars, cases, loot, seasons, rewards, activity] = await Promise.all([
      supabase.from("star_purchases")
        .select("id,profile_id,stars,status,product_sku,paid_at,created_at,updated_at,refunded_at,refund_reason,expires_at,telegram_payment_charge_id,payer_telegram_id")
        .gte("created_at", since90d)
        .order("created_at", { ascending: false })
        .limit(250),
      supabase.from("case_definitions")
        .select("sku,title,tier,description,remaining_supply,active,rare_pity,epic_pity,legendary_pity")
        .order("tier")
        .order("sku"),
      supabase.from("case_loot_definitions")
        .select("id,case_sku,reward_key,reward_kind,reward_label,amount,weight,rarity,metadata,active")
        .order("case_sku")
        .order("weight", { ascending: false })
        .limit(2000),
      supabase.from("seasons")
        .select("id,season_key,title,starts_at,ends_at,active,created_at,week_number,metadata")
        .order("starts_at", { ascending: false })
        .limit(60),
      supabase.from("season_rewards")
        .select("season_id,level,track,required_xp,reward_kind,reward_label,amount,metadata")
        .order("season_id")
        .order("level")
        .limit(3000),
      supabase.rpc("admin_economy_activity_v028"),
    ]);
    const firstError = stars.error || cases.error || loot.error || seasons.error || rewards.error || activity.error;
    if (firstError) throw firstError;

    const activityData = object(activity.data) as EconomyActivity;
    const profileIds = [...new Set([
      ...(stars.data || []).map((row) => String(row.profile_id)),
      ...(activityData.washPairs || []).flatMap((row) => [String(row.a || ""), String(row.b || "")]),
      ...(activityData.topRecipients || []).map((row) => String(row.profileId || "")),
    ].filter(validUuidLike))];
    const profiles = profileIds.length
      ? await supabase.from("profiles")
          .select("id,telegram_id,username,first_name,is_banned,hidden_from_leaderboard,balance,mxm_coins,stars_spent,vip_points,created_at")
          .in("id", profileIds)
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const profileMap = new Map((profiles.data || []).map((row) => [String(row.id), row]));

    const starSummary = { paid: 0, refunded: 0, pending: 0, expired: 0, paidStars: 0, refundedStars: 0, pendingStars: 0 };
    for (const row of stars.data || []) {
      const amount = Number(row.stars || 0);
      if (row.status === "paid") { starSummary.paid++; starSummary.paidStars += amount; }
      else if (row.status === "refunded") { starSummary.refunded++; starSummary.refundedStars += amount; }
      else if (row.status === "pending") { starSummary.pending++; starSummary.pendingStars += amount; }
      else if (row.status === "expired") starSummary.expired++;
    }

    const lootByCase = new Map<string, JsonMap[]>();
    for (const row of loot.data || []) {
      const key = String(row.case_sku);
      const items = lootByCase.get(key) || [];
      items.push(row as unknown as JsonMap);
      lootByCase.set(key, items);
    }
    const caseRows = (cases.data || []).map((row) => {
      const items = lootByCase.get(String(row.sku)) || [];
      const activeWeight = items.filter((item) => item.active !== false)
        .reduce((sum, item) => sum + Number(item.weight || 0), 0);
      return {
        ...row,
        activeWeight,
        loot: items.map((item) => ({
          ...item,
          chance: item.active !== false && activeWeight > 0 ? Number(item.weight || 0) / activeWeight : 0,
        })),
      };
    });

    const rewardsBySeason = new Map<string, JsonMap[]>();
    for (const row of rewards.data || []) {
      const key = String(row.season_id);
      const items = rewardsBySeason.get(key) || [];
      items.push(row as unknown as JsonMap);
      rewardsBySeason.set(key, items);
    }
    const seasonRows = (seasons.data || []).map((row) => {
      const items = rewardsBySeason.get(String(row.id)) || [];
      return {
        ...row,
        rewardCount: items.length,
        maxLevel: Math.max(0, ...items.map((item) => Number(item.level || 0))),
        rewards: items,
      };
    });

    const risks = (activityData.washPairs || []).map((row) => {
      const a = String(row.a || "");
      const b = String(row.b || "");
      const count = Number(row.count || 0);
      const volume = Number(row.volume || 0);
      const score = Math.min(100, Math.round(count * 6 + Math.log10(Math.max(1, volume)) * 14));
      return { a, b, count, volume, score, aProfile: profileMap.get(a) || null, bProfile: profileMap.get(b) || null };
    }).sort((a, b) => b.score - a.score || b.volume - a.volume);

    return NextResponse.json({
      stars: {
        summary: starSummary,
        purchases: (stars.data || []).map((row) => ({ ...row, profile: profileMap.get(String(row.profile_id)) || null })),
      },
      cases: caseRows,
      seasons: seasonRows,
      economy: {
        daily: Array.isArray(activityData.daily) ? activityData.daily : [],
        topRecipients: (activityData.topRecipients || []).map((row) => ({
          ...row,
          profile: profileMap.get(String(row.profileId || "")) || null,
        })),
      },
      risks,
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error, "Не удалось загрузить Advanced Ops");
  }
}

async function POSTHandler(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-ops-advanced", String(admin.id), 90, 60))) {
    return NextResponse.json({ error: "Слишком много операций" }, { status: 429 });
  }
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = text(body.action, 80);
  const actor = `admin:${admin.telegram_id}`;
  const supabase = getSupabaseAdmin();

  try {
    if (action === "profiles.bulk_moderate") {
      const ids = Array.isArray(body.profileIds)
        ? [...new Set(body.profileIds.map(String).filter(validUuidLike))].slice(0, MAX_BULK)
        : [];
      if (!ids.length) return NextResponse.json({ error: "Не выбраны профили" }, { status: 400 });
      const patch: JsonMap = { updated_at: new Date().toISOString() };
      if (typeof body.isBanned === "boolean") {
        patch.is_banned = body.isBanned;
        patch.ban_reason = body.isBanned ? text(body.reason, 300) || "Advanced Ops" : null;
        if (!body.isBanned) patch.banned_until = null;
      }
      if (typeof body.hiddenFromLeaderboard === "boolean") patch.hidden_from_leaderboard = body.hiddenFromLeaderboard;
      if (Object.keys(patch).length === 1) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const result = await supabase.from("profiles").update(patch).in("id", ids).eq("is_system", false).select("id");
      if (result.error) throw result.error;
      await audit(actor, "profiles.bulk_moderate", "profile_batch", undefined, {
        requested: ids.length,
        changed: result.data?.length || 0,
        isBanned: body.isBanned,
        hiddenFromLeaderboard: body.hiddenFromLeaderboard,
      });
      return NextResponse.json({ ok: true, changed: result.data?.length || 0 });
    }

    if (action === "case.update") {
      const sku = text(body.sku, 100);
      if (!sku) return NextResponse.json({ error: "Кейс не выбран" }, { status: 400 });
      const patch: JsonMap = {};
      if (typeof body.active === "boolean") patch.active = body.active;
      if (body.remainingSupply !== undefined) {
        const value = int(body.remainingSupply, 0, 10_000_000);
        if (value == null) return NextResponse.json({ error: "Некорректный supply" }, { status: 400 });
        patch.remaining_supply = value;
      }
      for (const [input, column] of [["rarePity", "rare_pity"], ["epicPity", "epic_pity"], ["legendaryPity", "legendary_pity"]] as const) {
        if (body[input] !== undefined) {
          const value = int(body[input], 0, 100_000);
          if (value == null) return NextResponse.json({ error: `Некорректный ${input}` }, { status: 400 });
          patch[column] = value;
        }
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const result = await supabase.from("case_definitions").update(patch).eq("sku", sku)
        .select("sku,title,active,remaining_supply,rare_pity,epic_pity,legendary_pity").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return NextResponse.json({ error: "Кейс не найден" }, { status: 404 });
      await audit(actor, "case.update", "case", sku, patch);
      return NextResponse.json({ ok: true, case: result.data });
    }

    if (action === "case.loot.update") {
      const lootId = text(body.lootId, 80);
      if (!validUuidLike(lootId)) return NextResponse.json({ error: "Некорректный loot ID" }, { status: 400 });
      const patch: JsonMap = {};
      if (typeof body.active === "boolean") patch.active = body.active;
      if (body.weight !== undefined) {
        const value = int(body.weight, 0, 10_000_000);
        if (value == null) return NextResponse.json({ error: "Некорректный weight" }, { status: 400 });
        patch.weight = value;
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const result = await supabase.from("case_loot_definitions").update(patch).eq("id", lootId)
        .select("id,case_sku").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return NextResponse.json({ error: "Loot не найден" }, { status: 404 });
      await audit(actor, "case.loot.update", "case_loot", lootId, { ...patch, caseSku: result.data.case_sku });
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
        const week = int(body.weekNumber, 1, 60);
        if (week == null) return NextResponse.json({ error: "Некорректная неделя" }, { status: 400 });
        patch.week_number = week;
      }
      for (const [input, column] of [["startsAt", "starts_at"], ["endsAt", "ends_at"]] as const) {
        if (body[input] !== undefined) {
          const parsed = new Date(String(body[input]));
          if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: `Некорректный ${input}` }, { status: 400 });
          patch[column] = parsed.toISOString();
        }
      }
      const hasActiveChange = typeof body.active === "boolean";
      if (!Object.keys(patch).length && !hasActiveChange) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });

      if (Object.keys(patch).length) {
        const update = await supabase.from("seasons").update(patch).eq("id", seasonId).select("id").maybeSingle();
        if (update.error) throw update.error;
        if (!update.data) return NextResponse.json({ error: "Сезон не найден" }, { status: 404 });
      }
      let activeResult: unknown = null;
      if (hasActiveChange) {
        const activation = await supabase.rpc("admin_set_active_season_v0760", {
          p_season_id: seasonId,
          p_active: body.active as boolean,
        });
        if (activation.error) throw activation.error;
        activeResult = activation.data;
      }
      const final = await supabase.from("seasons").select("id,title,active,week_number,starts_at,ends_at").eq("id", seasonId).maybeSingle();
      if (final.error) throw final.error;
      if (!final.data) return NextResponse.json({ error: "Сезон не найден" }, { status: 404 });
      await audit(actor, "season.update", "season", seasonId, { ...patch, ...(hasActiveChange ? { active: body.active } : {}) });
      return NextResponse.json({ ok: true, season: final.data, activation: activeResult });
    }

    if (action === "stars.refund") {
      if (!(await enforceRateLimit(request, "admin-stars-refund-advanced", String(admin.id), 6, 3600))) {
        return NextResponse.json({ error: "Лимит возвратов Stars временно исчерпан" }, { status: 429 });
      }
      const purchaseId = text(body.purchaseId, 80);
      const reason = text(body.reason, 500);
      if (!validUuidLike(purchaseId) || reason.length < 5) {
        return NextResponse.json({ error: "Укажите покупку и причину возврата" }, { status: 400 });
      }
      const purchase = await supabase.from("star_purchases")
        .select("id,status,stars,product_sku,telegram_payment_charge_id,payer_telegram_id,refunded_at")
        .eq("id", purchaseId)
        .maybeSingle();
      if (purchase.error) throw purchase.error;
      if (!purchase.data) return NextResponse.json({ error: "Покупка не найдена" }, { status: 404 });

      if (purchase.data.status === "refunded" || purchase.data.refunded_at) {
        const reversal = await supabase.rpc("reverse_star_purchase_fulfillment_v074", { p_purchase_id: purchaseId });
        if (reversal.error) throw reversal.error;
        return NextResponse.json({ ok: true, alreadyRefunded: true, reversal: reversal.data });
      }

      const chargeId = String(purchase.data.telegram_payment_charge_id || "").trim();
      const payerId = Number(purchase.data.payer_telegram_id);
      if (purchase.data.status !== "paid" || chargeId.length < 4 || !Number.isSafeInteger(payerId) || payerId <= 0) {
        return NextResponse.json({ error: "Refund доступен только для paid с Telegram charge ID" }, { status: 409 });
      }

      let telegramRefunded = false;
      try {
        telegramRefunded = await telegramBotApi<boolean>("refundStarPayment", {
          user_id: payerId,
          telegram_payment_charge_id: chargeId,
        });
      } catch (error) {
        await audit(actor, "stars.refund_failed", "star_purchase", purchaseId, { reason, stage: "telegram_bot_api" });
        return NextResponse.json({ error: "Telegram не подтвердил возврат; локальное состояние не изменено" }, { status: 502 });
      }
      if (telegramRefunded !== true) {
        return NextResponse.json({ error: "Telegram не подтвердил возврат; локальное состояние не изменено" }, { status: 502 });
      }

      const transition = await supabase.rpc("mark_star_purchase_refunded_v200", {
        p_purchase_id: purchaseId,
        p_charge_id: chargeId,
        p_reason: reason,
        p_metadata: { actor, source: "admin_advanced", fulfillmentReversal: "automatic_v0760" },
      });
      const transitioned = object(transition.data);
      if (transition.error || transitioned.status !== "refunded") {
        await audit(actor, "stars.refund_reconcile", "star_purchase", purchaseId, { reason, stage: "local_transition_after_telegram" });
        return NextResponse.json({ error: "Telegram вернул Stars, но локальная запись требует сверки" }, { status: 500 });
      }

      // The v0.76 DB trigger already performs this reversal on the transition.
      // Calling it again is an idempotent verification and recovers old rows.
      const reversal = await supabase.rpc("reverse_star_purchase_fulfillment_v074", { p_purchase_id: purchaseId });
      if (reversal.error) {
        await audit(actor, "stars.refund_reversal_failed", "star_purchase", purchaseId, { reason, error: reversal.error.message });
        return NextResponse.json({ error: "Stars возвращены, но игровой grant требует сверки" }, { status: 500 });
      }
      await audit(actor, "stars.refund", "star_purchase", purchaseId, {
        reason,
        stars: Number(purchase.data.stars || 0),
        productSku: purchase.data.product_sku || null,
        reversal: reversal.data,
      });
      return NextResponse.json({ ok: true, status: "refunded", reversal: reversal.data });
    }

    return NextResponse.json({ error: "Неизвестная Advanced операция" }, { status: 400 });
  } catch (error) {
    console.error("admin advanced action", action, error);
    return apiFailure(error, "Advanced операция не выполнена", 400);
  }
}

export const GET = withApiErrors("app/api/admin/ops/advanced/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/admin/ops/advanced/route.ts:POST", POSTHandler);
