import { readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { syncGiftCatalog } from "@/lib/gift-catalog";
import { configureGiftMarketLiquidityPolicy, ensureNpcMarketLiquidity, evaluatePlayerMarketHandoff, getGiftMarketLiquidityState } from "@/lib/npc-market";
import { telegramBotApi } from "@/lib/telegram-bot";
import { safeIsoDate } from "@/lib/safe-data";

export const runtime = "nodejs";

function text(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max); }
function number(value: unknown) { const result = Number(value); return Number.isFinite(result) ? result : null; }

async function audit(actor: string, action: string, targetType?: string, targetId?: string, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("admin_audit_log").insert({ actor, action, target_type: targetType || null, target_id: targetId || null, payload });
  if (error) console.error("admin audit", error);
}

async function POSTHandler(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-control", String(admin.id), 90, 60))) return NextResponse.json({ error: "Слишком много административных операций." }, { status: 429 });
  const actor = `admin:${admin.telegram_id}`;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = text(body.action, 80);
  const supabase = getSupabaseAdmin();

  try {
    if (action === "balance.adjust") {
      const profileId = text(body.profileId, 80);
      const delta = number(body.delta);
      if (!profileId || delta == null) return NextResponse.json({ error: "Укажите игрока и изменение баланса" }, { status: 400 });
      const { data, error } = await supabase.rpc("admin_adjust_balance", { p_profile_id: profileId, p_delta: delta, p_actor: actor, p_reason: text(body.reason, 300) });
      if (error) throw error;
      return NextResponse.json({ ok: true, balance: Number(data) });
    }

    if (action === "balance.set") {
      const profileId = text(body.profileId, 80);
      const target = number(body.balance);
      if (!profileId || target == null || target < 0) return NextResponse.json({ error: "Некорректный баланс" }, { status: 400 });
      const current = await supabase.from("profiles").select("balance").eq("id", profileId).single();
      if (current.error || !current.data) throw current.error || new Error("Игрок не найден");
      const delta = target - Number(current.data.balance);
      const result = await supabase.rpc("admin_adjust_balance", { p_profile_id: profileId, p_delta: delta, p_actor: actor, p_reason: text(body.reason, 300) || "Установлен точный баланс" });
      if (result.error) throw result.error;
      return NextResponse.json({ ok: true, balance: Number(result.data) });
    }

    if (action === "profile.set_xp") {
      const profileId = text(body.profileId, 80);
      const xpValue = number(body.xp);
      if (!profileId || xpValue == null || xpValue < 0 || !Number.isFinite(xpValue)) {
        return NextResponse.json({ error: "Некорректное значение XP" }, { status: 400 });
      }
      const xp = Math.floor(xpValue);
      const { error } = await supabase.from("profiles").update({ xp, updated_at: new Date().toISOString() }).eq("id", profileId);
      if (error) throw error;
      await audit(actor, "profile.set_xp", "profile", profileId, { xp });
      return NextResponse.json({ ok: true, xp });
    }

    if (action === "profile.moderate") {
      const profileId = text(body.profileId, 80);
      const patch: Record<string, unknown> = {};
      if (typeof body.isBanned === "boolean") patch.is_banned = body.isBanned;
      if (typeof body.hiddenFromLeaderboard === "boolean") patch.hidden_from_leaderboard = body.hiddenFromLeaderboard;
      if (body.banReason !== undefined) patch.ban_reason = text(body.banReason, 500) || null;
      if (body.bannedUntil !== undefined) {
        const bannedUntil = body.bannedUntil ? safeIsoDate(body.bannedUntil, "") : null;
        if (body.bannedUntil && !bannedUntil) return NextResponse.json({ error: "Некорректная дата окончания блокировки" }, { status: 400 });
        patch.banned_until = bannedUntil;
      }
      if (!profileId || !Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const { error } = await supabase.from("profiles").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", profileId);
      if (error) throw error;
      await audit(actor, "profile.moderate", "profile", profileId, patch);
      return NextResponse.json({ ok: true });
    }

    if (action === "mission.create") {
      const key = text(body.key, 80).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      const title = text(body.title, 120);
      const description = text(body.description, 500);
      const period = typeof body.period === "string" && ["onboarding", "daily", "weekly"].includes(body.period) ? body.period : "daily";
      const reward = number(body.reward);
      const target = Math.floor(number(body.target) ?? 0);
      const sortOrder = Math.floor(number(body.sortOrder) ?? 100);
      const actionType = text(body.actionType, 80);
      if (!key || !title || !description || !actionType || reward == null || reward < 0 || reward > 100000 || target < 1 || target > 1000000) return NextResponse.json({ error: "Проверьте поля задания, награду и цель" }, { status: 400 });
      const { data, error } = await supabase.from("missions").insert({ key, title, description, period, reward, target, action_type: actionType, sort_order: sortOrder, active: true }).select("id").single();
      if (error) throw error;
      await audit(actor, "mission.create", "mission", String(data.id), { key, title, period, reward, target, actionType });
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (action === "mission.update") {
      const id = text(body.id, 80);
      const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch.title = text(body.title, 120);
      if (body.description !== undefined) patch.description = text(body.description, 500);
      if (typeof body.period === "string" && ["onboarding", "daily", "weekly"].includes(body.period)) patch.period = body.period;
      if (body.reward !== undefined) {
        const reward = number(body.reward);
        if (reward == null || reward < 0 || reward > 100000) return NextResponse.json({ error: "Некорректная награда задания" }, { status: 400 });
        patch.reward = reward;
      }
      if (body.target !== undefined) {
        const target = number(body.target);
        if (target == null || target < 1 || target > 1000000) return NextResponse.json({ error: "Некорректная цель задания" }, { status: 400 });
        patch.target = Math.floor(target);
      }
      if (body.actionType !== undefined) patch.action_type = text(body.actionType, 80);
      if (number(body.sortOrder) != null) patch.sort_order = Math.floor(number(body.sortOrder)!);
      if (typeof body.active === "boolean") patch.active = body.active;
      if (!id || !Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const { error } = await supabase.from("missions").update(patch).eq("id", id);
      if (error) throw error;
      await audit(actor, "mission.update", "mission", id, patch);
      return NextResponse.json({ ok: true });
    }

    if (action === "mission.delete") {
      const id = text(body.id, 80);
      if (!id) return NextResponse.json({ error: "Задание не выбрано" }, { status: 400 });
      const { error } = await supabase.from("missions").delete().eq("id", id);
      if (error) throw error;
      await audit(actor, "mission.delete", "mission", id);
      return NextResponse.json({ ok: true });
    }

    if (action === "coin.create") {
      const creatorProfileId = body.creatorProfileId ? text(body.creatorProfileId, 80) : null;
      const name = text(body.name, 32);
      const symbol = text(body.symbol, 8).toUpperCase();
      const description = text(body.description, 180);
      const imageUrl = body.imageUrl ? text(body.imageUrl, 1000) : null;
      const { data, error } = await supabase.rpc("admin_create_coin", { p_creator_profile_id: creatorProfileId, p_name: name, p_symbol: symbol, p_description: description, p_image_url: imageUrl, p_actor: actor });
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data });
    }

    if (action === "coin.update") {
      const id = text(body.id, 80);
      const patch: Record<string, unknown> = {};
      if (typeof body.status === "string" && ["active", "dead", "graduated"].includes(body.status)) patch.status = body.status;
      if (typeof body.hiddenFromMarket === "boolean") patch.hidden_from_market = body.hiddenFromMarket;
      if (body.name !== undefined) patch.name = text(body.name, 32);
      if (body.description !== undefined) patch.description = text(body.description, 180);
      if (!id || !Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const { error } = await supabase.from("coins").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      await audit(actor, "coin.update", "coin", id, patch);
      return NextResponse.json({ ok: true });
    }

    if (action === "coin.delete") {
      const id = text(body.id, 80);
      if (!id) return NextResponse.json({ error: "Коин не выбран" }, { status: 400 });
      const { error } = await supabase.from("coins").delete().eq("id", id);
      if (error) throw error;
      await audit(actor, "coin.delete", "coin", id);
      return NextResponse.json({ ok: true });
    }

    if (action === "gift.list") {
      const id = text(body.id, 80);
      const price = body.price == null || body.price === "" ? null : number(body.price);
      const gift = await supabase.from("virtual_gifts").select("owner_profile_id").eq("id", id).single();
      if (gift.error || !gift.data) throw gift.error || new Error("Подарок не найден");
      if (price !== null && (price == null || price <= 0)) return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
      if (price !== null) {
        const [liquidity, owner] = await Promise.all([
          getGiftMarketLiquidityState(),
          supabase.from("profiles").select("is_system").eq("id", gift.data.owner_profile_id).maybeSingle(),
        ]);
        if (owner.error) throw owner.error;
        if (liquidity.playerOnly && owner.data?.is_system) {
          return NextResponse.json({ error: "Рынок уже передан игрокам. Системные подарки больше нельзя выставлять." }, { status: 409 });
        }
      }
      const result = await supabase.rpc("list_virtual_gift", { p_profile_id: gift.data.owner_profile_id, p_virtual_gift_id: id, p_price: price });
      if (result.error) throw result.error;
      await audit(actor, price == null ? "gift.unlist" : "gift.list", "virtual_gift", id, { price });
      return NextResponse.json({ ok: true });
    }

    if (action === "gift.transfer") {
      const id = text(body.id, 80);
      const ownerProfileId = text(body.ownerProfileId, 80);
      if (!id || !ownerProfileId) return NextResponse.json({ error: "Выберите подарок и нового владельца" }, { status: 400 });
      const { error } = await supabase.rpc("admin_transfer_virtual_gift", { p_virtual_gift_id: id, p_owner_profile_id: ownerProfileId, p_actor: actor });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "catalog.source.add") {
      const telegramId = number(body.telegramId);
      const label = text(body.label, 120) || null;
      if (telegramId == null || !Number.isSafeInteger(telegramId) || telegramId <= 0) {
        return NextResponse.json({ error: "Укажите числовой Telegram ID источника" }, { status: 400 });
      }
      const { data, error } = await supabase
        .from("gift_catalog_sources")
        .upsert({ telegram_id: telegramId, label, active: true, updated_at: new Date().toISOString() }, { onConflict: "telegram_id" })
        .select("id")
        .single();
      if (error) throw error;
      await audit(actor, "catalog.source.add", "gift_catalog_source", String(data.id), { telegramId, label });
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (action === "catalog.source.toggle") {
      const id = text(body.id, 80);
      if (!id || typeof body.active !== "boolean") return NextResponse.json({ error: "Некорректный источник" }, { status: 400 });
      const { error } = await supabase.from("gift_catalog_sources").update({ active: body.active, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      await audit(actor, "catalog.source.toggle", "gift_catalog_source", id, { active: body.active });
      return NextResponse.json({ ok: true });
    }

    if (action === "catalog.source.delete") {
      const id = text(body.id, 80);
      if (!id) return NextResponse.json({ error: "Источник не выбран" }, { status: 400 });
      const { error } = await supabase.from("gift_catalog_sources").delete().eq("id", id);
      if (error) throw error;
      await audit(actor, "catalog.source.delete", "gift_catalog_source", id);
      return NextResponse.json({ ok: true });
    }

    if (action === "catalog.sync") {
      if (!(await enforceRateLimit(request, "admin-catalog-sync", String(admin.id), 2, 600))) {
        return NextResponse.json({ error: "Синхронизацию каталога можно запускать не чаще двух раз за 10 минут." }, { status: 429 });
      }
      const catalog = await syncGiftCatalog();
      const liquidity = await ensureNpcMarketLiquidity({ force: true, targetListings: 1000 });
      await audit(actor, "catalog.sync", "telegram_hybrid_catalog", undefined, { catalog, liquidity });
      return NextResponse.json({ ok: true, catalog, liquidity });
    }

    if (action === "npc.policy") {
      const playerOwnedThreshold = number(body.playerOwnedThreshold);
      const playerListedThreshold = number(body.playerListedThreshold);
      const activeSellersThreshold = number(body.activeSellersThreshold);
      if (![playerOwnedThreshold, playerListedThreshold, activeSellersThreshold].every((value) => value != null && Number.isInteger(value) && value > 0)) {
        return NextResponse.json({ error: "Пороги рынка должны быть положительными целыми числами" }, { status: 400 });
      }
      const result = await configureGiftMarketLiquidityPolicy({
        playerOwnedThreshold: playerOwnedThreshold!,
        playerListedThreshold: playerListedThreshold!,
        activeSellersThreshold: activeSellersThreshold!,
      });
      await audit(actor, "npc.policy", "gift_liquidity", undefined, { result });
      return NextResponse.json({ ok: true, result });
    }

    if (action === "npc.handoff") {
      const result = await evaluatePlayerMarketHandoff(true);
      await audit(actor, "npc.handoff", "gift_liquidity", undefined, { result });
      return NextResponse.json({ ok: true, result });
    }

    if (action === "npc.tick") {
      if (!(await enforceRateLimit(request, "admin-npc-tick", String(admin.id), 4, 600))) {
        return NextResponse.json({ error: "Обновление системной ликвидности временно ограничено." }, { status: 429 });
      }
      const targetListings = Math.max(1, Math.min(2000, Math.floor(number(body.targetListings) ?? 18)));
      const result = await ensureNpcMarketLiquidity({ force: true, targetListings });
      await audit(actor, "npc.tick", "gift_liquidity", undefined, { result });
      return NextResponse.json({ ok: true, result });
    }

    if (action === "stars.refund") {
      if (!(await enforceRateLimit(request, "admin-stars-refund", String(admin.id), 6, 3600))) {
        return NextResponse.json({ error: "Лимит возвратов Stars временно исчерпан." }, { status: 429 });
      }
      const purchaseId = text(body.purchaseId, 80);
      const reason = text(body.reason, 500);
      if (!validUuidLike(purchaseId) || reason.length < 5) {
        return NextResponse.json({ error: "Укажите корректный ID покупки и причину возврата." }, { status: 400 });
      }
      const purchase = await supabase.from("star_purchases")
        .select("id,status,stars,product_sku,telegram_payment_charge_id,payer_telegram_id,refunded_at")
        .eq("id", purchaseId)
        .maybeSingle();
      if (purchase.error) throw purchase.error;
      if (!purchase.data) return NextResponse.json({ error: "Покупка Stars не найдена." }, { status: 404 });
      if (purchase.data.status === "refunded" || purchase.data.refunded_at) {
        return NextResponse.json({ error: "Эта покупка уже возвращена." }, { status: 409 });
      }
      const chargeId = String(purchase.data.telegram_payment_charge_id || "").trim();
      const payerTelegramId = Number(purchase.data.payer_telegram_id);
      if (purchase.data.status !== "paid" || chargeId.length < 4 || !Number.isSafeInteger(payerTelegramId) || payerTelegramId <= 0) {
        return NextResponse.json({ error: "Возврат доступен только для оплаченной покупки с сохранёнными charge ID и Telegram ID плательщика." }, { status: 409 });
      }

      let telegramRefunded = false;
      try {
        telegramRefunded = await telegramBotApi<boolean>("refundStarPayment", {
          user_id: payerTelegramId,
          telegram_payment_charge_id: chargeId,
        });
      } catch (error) {
        console.error("Telegram Stars refund", purchaseId, error instanceof Error ? error.message : "unknown error");
        await audit(actor, "stars.refund_failed", "star_purchase", purchaseId, { reason, stage: "telegram_bot_api" });
        return NextResponse.json({ error: "Telegram не подтвердил возврат Stars; состояние покупки не изменено." }, { status: 502 });
      }
      if (telegramRefunded !== true) {
        return NextResponse.json({ error: "Telegram не подтвердил возврат Stars; состояние покупки не изменено." }, { status: 502 });
      }

      const refundedAt = new Date().toISOString();
      const refundMetadata = {
        actor,
        adminProfileId: String(admin.id),
        via: "telegram_bot_api",
        botApiMethod: "refundStarPayment",
        fulfillmentReversal: "manual_review_required",
      };
      const transition = await supabase.rpc("mark_star_purchase_refunded_v200", {
        p_purchase_id: purchaseId,
        p_charge_id: chargeId,
        p_reason: reason,
        p_metadata: refundMetadata,
      });
      const transitioned = transition.data && typeof transition.data === "object" && !Array.isArray(transition.data)
        ? transition.data as Record<string, unknown>
        : {};
      if (transition.error || transitioned.status !== "refunded") {
        console.error("Stars refund reconciliation required", purchaseId, transition.error?.message || String(transitioned.status || "unexpected transition"));
        await audit(actor, "stars.refund_reconcile", "star_purchase", purchaseId, { reason, refundedAt });
        return NextResponse.json({ error: "Telegram выполнил возврат, но локальная запись требует ручной сверки." }, { status: 500 });
      }
      await audit(actor, "stars.refund", "star_purchase", purchaseId, {
        reason,
        refundedAt,
        stars: Number(purchase.data.stars || 0),
        productSku: purchase.data.product_sku || null,
        fulfillmentReversal: "manual_review_required",
      });
      return NextResponse.json({ ok: true, purchaseId, status: "refunded", refundedAt });
    }

    if (action === "stars.refund.reconcile") {
      if (!(await enforceRateLimit(request, "admin-stars-refund-reconcile", String(admin.id), 30, 3600))) {
        return NextResponse.json({ error: "Лимит операций сверки возвратов временно исчерпан." }, { status: 429 });
      }
      const purchaseId = text(body.purchaseId, 80);
      const notes = text(body.notes, 1_000);
      if (!validUuidLike(purchaseId) || notes.length < 5) {
        return NextResponse.json({ error: "Укажите корректный ID покупки и примечание о ручной сверке." }, { status: 400 });
      }
      const reconciliation = await supabase.rpc("reconcile_star_refund_v028", {
        p_purchase_id: purchaseId,
        p_actor: actor,
        p_notes: notes,
      });
      if (reconciliation.error) throw reconciliation.error;
      const result = reconciliation.data && typeof reconciliation.data === "object" && !Array.isArray(reconciliation.data)
        ? reconciliation.data as Record<string, unknown>
        : {};
      if (result.status === "missing") {
        return NextResponse.json({ error: "Покупка Stars не найдена." }, { status: 404 });
      }
      if (result.reconciled !== true) {
        return NextResponse.json({ error: "Сверку можно завершить только для возвращённой покупки, ожидающей ручной проверки." }, { status: 409 });
      }
      if (result.alreadyReconciled !== true) {
        await audit(actor, "stars.refund_reconciled", "star_purchase", purchaseId, {
          notes,
          reconciledAt: result.reconciledAt || new Date().toISOString(),
          automaticReversal: false,
        });
      }
      return NextResponse.json({
        ok: true,
        purchaseId,
        status: "reconciled",
        alreadyReconciled: result.alreadyReconciled === true,
        automaticReversal: false,
      });
    }

    if (action === "promo.create") {
      const code = text(body.code, 32).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
      const reward = number(body.reward);
      const maxUses = Math.floor(number(body.maxUses) ?? 0);
      const note = text(body.note, 500);
      const startsAt = body.startsAt ? safeIsoDate(body.startsAt, "") : null;
      const endsAt = body.endsAt ? safeIsoDate(body.endsAt, "") : null;
      if (body.startsAt && !startsAt) return NextResponse.json({ error: "Некорректная дата начала промокода" }, { status: 400 });
      if (body.endsAt && !endsAt) return NextResponse.json({ error: "Некорректная дата окончания промокода" }, { status: 400 });
      if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return NextResponse.json({ error: "Дата окончания должна быть позже даты начала" }, { status: 400 });
      if (!/^[A-Z0-9_-]{3,32}$/.test(code) || reward == null || reward <= 0 || reward > 100000 || maxUses < 1 || maxUses > 1000000) return NextResponse.json({ error: "Проверьте промокод, награду и лимит" }, { status: 400 });
      const { data, error } = await supabase.from("promo_codes").insert({ code, reward, max_uses: maxUses, active: true, starts_at: startsAt, ends_at: endsAt, note, created_by: actor }).select("id").single();
      if (error) throw error;
      await audit(actor, "promo.create", "promo_code", String(data.id), { code, reward, maxUses });
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (action === "promo.update") {
      const id = text(body.id, 80);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.active === "boolean") patch.active = body.active;
      if (body.reward !== undefined) {
        const reward = number(body.reward);
        if (reward == null || reward <= 0 || reward > 100000) return NextResponse.json({ error: "Некорректная награда промокода" }, { status: 400 });
        patch.reward = reward;
      }
      if (body.maxUses !== undefined) {
        const maxUses = number(body.maxUses);
        if (maxUses == null || maxUses < 1 || maxUses > 1000000) return NextResponse.json({ error: "Некорректный лимит использований" }, { status: 400 });
        patch.max_uses = Math.floor(maxUses);
      }
      if (body.note !== undefined) patch.note = text(body.note, 500);
      if (!id) return NextResponse.json({ error: "Промокод не выбран" }, { status: 400 });
      const { error } = await supabase.from("promo_codes").update(patch).eq("id", id);
      if (error) throw error;
      await audit(actor, "promo.update", "promo_code", id, patch);
      return NextResponse.json({ ok: true });
    }

    if (action === "promo.delete") {
      const id = text(body.id, 80);
      if (!id) return NextResponse.json({ error: "Промокод не выбран" }, { status: 400 });
      const current = await supabase.from("promo_codes").select("uses_count").eq("id", id).single();
      if (current.error || !current.data) throw current.error || new Error("Промокод не найден");
      if (Number(current.data.uses_count||0)>0) return NextResponse.json({ error: "Использованный промокод нельзя удалить — отключите его, чтобы сохранить историю." }, { status: 409 });
      const { error } = await supabase.from("promo_codes").delete().eq("id", id);
      if (error) throw error;
      await audit(actor, "promo.delete", "promo_code", id);
      return NextResponse.json({ ok: true });
    }

    if (action === "economy.update") {
      const launchFee = number(body.coinLaunchFee);
      const launchCooldown = Math.floor(number(body.coinLaunchCooldownHours) ?? -1);
      const maxActive = Math.floor(number(body.coinMaxActive) ?? -1);
      const giftFeeBps = Math.floor(number(body.giftFeeBps) ?? -1);
      if (launchFee == null || launchFee < 0 || launchFee > 100000 || launchCooldown < 1 || launchCooldown > 168 || maxActive < 1 || maxActive > 20 || giftFeeBps < 0 || giftFeeBps > 1000) {
        return NextResponse.json({ error: "Некорректные параметры экономики" }, { status: 400 });
      }
      const patch = {
        coin_launch_fee: launchFee,
        coin_launch_cooldown_hours: launchCooldown,
        coin_max_active: maxActive,
        gift_fee_bps: giftFeeBps,
        updated_at: new Date().toISOString(),
      };
      const settings = await supabase.from("economy_settings")
        .update(patch)
        .eq("singleton", true)
        .select("coin_launch_fee,coin_launch_cooldown_hours,coin_max_active,gift_fee_bps,updated_at")
        .single();
      if (settings.error) throw settings.error;
      await audit(actor, "economy.update", "economy_settings", "singleton", patch);
      return NextResponse.json({ ok: true, economy: settings.data });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    console.error("admin action", action, error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 400 });
  }
}
export const POST = withApiErrors("app/api/admin/action/route.ts:POST", POSTHandler);
