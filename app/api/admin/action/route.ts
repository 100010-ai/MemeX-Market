import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { syncGiftCatalog } from "@/lib/gift-catalog";
import { ensureNpcMarketLiquidity } from "@/lib/npc-market";
import { ensureBotCanVerifyChat, normalizeSponsoredUrl, telegramChatIdFrom } from "@/lib/sponsored-tasks";

export const runtime = "nodejs";

function text(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max); }
function number(value: unknown) { const result = Number(value); return Number.isFinite(result) ? result : null; }

async function audit(actor: string, action: string, targetType?: string, targetId?: string, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("admin_audit_log").insert({ actor, action, target_type: targetType || null, target_id: targetId || null, payload });
  if (error) console.error("admin audit", error);
}

export async function POST(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-control", String(admin.id), 90, 60))) return NextResponse.json({ error: "Слишком много административных операций." }, { status: 429 });
  const actor = `admin:${admin.telegram_id}`;
  const body = await request.json().catch(() => ({}));
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
      if (body.bannedUntil !== undefined) patch.banned_until = body.bannedUntil ? new Date(String(body.bannedUntil)).toISOString() : null;
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
      const period = ["onboarding", "daily", "weekly"].includes(body.period) ? body.period : "daily";
      const reward = number(body.reward);
      const target = Math.floor(number(body.target) ?? 0);
      const sortOrder = Math.floor(number(body.sortOrder) ?? 100);
      const actionType = text(body.actionType, 80);
      if (!key || !title || !description || !actionType || reward == null || reward < 0 || target < 1) return NextResponse.json({ error: "Заполните все поля задания" }, { status: 400 });
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
      if (["onboarding", "daily", "weekly"].includes(body.period)) patch.period = body.period;
      if (number(body.reward) != null) patch.reward = number(body.reward);
      if (number(body.target) != null) patch.target = Math.max(1, Math.floor(number(body.target)!));
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
      if (["active", "dead", "graduated"].includes(body.status)) patch.status = body.status;
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
      const catalog = await syncGiftCatalog();
      const liquidity = await ensureNpcMarketLiquidity({ force: true, targetListings: 1000 });
      await audit(actor, "catalog.sync", "telegram_hybrid_catalog", undefined, { catalog, liquidity });
      return NextResponse.json({ ok: true, catalog, liquidity });
    }

    if (action === "npc.tick") {
      const targetListings = Math.max(1, Math.min(2000, Math.floor(number(body.targetListings) ?? 18)));
      const result = await ensureNpcMarketLiquidity({ force: true, targetListings });
      await audit(actor, "npc.tick", "gift_liquidity", undefined, { result });
      return NextResponse.json({ ok: true, result });
    }

    if (action === "sponsor.create") {
      const advertiserName = text(body.advertiserName, 80);
      const title = text(body.title, 120);
      const description = text(body.description, 500);
      const instructions = text(body.instructions, 1000);
      const verificationType = ["telegram_membership", "link_visit", "manual"].includes(String(body.verificationType)) ? String(body.verificationType) : "manual";
      const targetUrl = normalizeSponsoredUrl(body.targetUrl);
      const telegramChatId = telegramChatIdFrom(body.telegramChatId, targetUrl) || null;
      const buttonLabel = text(body.buttonLabel, 40) || "Открыть";
      const reward = number(body.reward);
      const maxCompletions = Math.floor(number(body.maxCompletions) ?? 0);
      const priority = Math.max(0, Math.min(10000, Math.floor(number(body.priority) ?? 100)));
      const status = ["draft", "active", "paused", "ended"].includes(String(body.status)) ? String(body.status) : "draft";
      const startsAt = body.startsAt ? new Date(String(body.startsAt)).toISOString() : null;
      const endsAt = body.endsAt ? new Date(String(body.endsAt)).toISOString() : null;
      const featured = Boolean(body.featured);
      const internalNote = text(body.internalNote, 1000);
      if (!advertiserName || !title || reward == null || reward <= 0 || reward > 100000 || maxCompletions < 1 || maxCompletions > 1000000) return NextResponse.json({ error: "Проверьте название, награду и лимит участников" }, { status: 400 });
      if (endsAt && startsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return NextResponse.json({ error: "Дата окончания должна быть позже даты старта" }, { status: 400 });
      if (verificationType === "telegram_membership") {
        if (!telegramChatId) return NextResponse.json({ error: "Укажите @username или ID Telegram-канала" }, { status: 400 });
        if (status === "active") await ensureBotCanVerifyChat(telegramChatId);
      }
      const { data, error } = await supabase.from("sponsored_campaigns").insert({ advertiser_name: advertiserName, title, description, instructions, verification_type: verificationType, target_url: targetUrl, telegram_chat_id: telegramChatId, button_label: buttonLabel, reward, max_completions: maxCompletions, status, starts_at: startsAt, ends_at: endsAt, priority, featured, internal_note: internalNote, created_by: actor }).select("id").single();
      if (error) throw error;
      await audit(actor, "sponsor.create", "sponsored_campaign", String(data.id), { advertiserName, title, verificationType, reward, maxCompletions, status });
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (action === "sponsor.update") {
      const id = text(body.id, 80);
      if (!id) return NextResponse.json({ error: "Кампания не выбрана" }, { status: 400 });
      const current = await supabase.from("sponsored_campaigns").select("verification_type,target_url,telegram_chat_id,status,completed_count").eq("id", id).single();
      if (current.error || !current.data) throw current.error || new Error("Кампания не найдена");
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.advertiserName !== undefined) patch.advertiser_name = text(body.advertiserName, 80);
      if (body.title !== undefined) patch.title = text(body.title, 120);
      if (body.description !== undefined) patch.description = text(body.description, 500);
      if (body.instructions !== undefined) patch.instructions = text(body.instructions, 1000);
      if (body.buttonLabel !== undefined) patch.button_label = text(body.buttonLabel, 40) || "Открыть";
      if (body.targetUrl !== undefined) patch.target_url = normalizeSponsoredUrl(body.targetUrl);
      if (body.telegramChatId !== undefined) patch.telegram_chat_id = text(body.telegramChatId, 120) || null;
      if (["telegram_membership", "link_visit", "manual"].includes(String(body.verificationType))) patch.verification_type = String(body.verificationType);
      if (["draft", "active", "paused", "ended"].includes(String(body.status))) patch.status = String(body.status);
      if (number(body.reward) != null) { const reward = number(body.reward)!; if (reward <= 0 || reward > 100000) return NextResponse.json({ error: "Некорректная награда" }, { status: 400 }); if (Number(current.data.completed_count||0)>0) return NextResponse.json({ error: "Награду нельзя менять после первых выполнений — скопируйте кампанию и запустите новую" }, { status: 409 }); patch.reward = reward; }
      if (number(body.maxCompletions) != null) { const max = Math.floor(number(body.maxCompletions)!); if (max < Math.max(1,Number(current.data.completed_count||0)) || max > 1000000) return NextResponse.json({ error: "Лимит не может быть меньше уже выполненных заданий" }, { status: 400 }); patch.max_completions = max; }
      if (number(body.priority) != null) patch.priority = Math.max(0, Math.min(10000, Math.floor(number(body.priority)!)));
      if (typeof body.featured === "boolean") patch.featured = body.featured;
      if (body.startsAt !== undefined) patch.starts_at = body.startsAt ? new Date(String(body.startsAt)).toISOString() : null;
      if (body.endsAt !== undefined) patch.ends_at = body.endsAt ? new Date(String(body.endsAt)).toISOString() : null;
      if (body.internalNote !== undefined) patch.internal_note = text(body.internalNote, 1000);
      const nextType = String(patch.verification_type ?? current.data.verification_type);
      const nextUrl = String(patch.target_url ?? current.data.target_url);
      const nextChat = telegramChatIdFrom(patch.telegram_chat_id ?? current.data.telegram_chat_id, nextUrl);
      const nextStatus = String(patch.status ?? current.data.status);
      if (nextType === "telegram_membership" && nextStatus === "active") {
        if (!nextChat) return NextResponse.json({ error: "Укажите Telegram-канал" }, { status: 400 });
        await ensureBotCanVerifyChat(nextChat);
        patch.telegram_chat_id = nextChat;
      }
      const { error } = await supabase.from("sponsored_campaigns").update(patch).eq("id", id);
      if (error) throw error;
      await audit(actor, "sponsor.update", "sponsored_campaign", id, patch);
      return NextResponse.json({ ok: true });
    }

    if (action === "sponsor.clone") {
      const id = text(body.id, 80);
      const source = await supabase.from("sponsored_campaigns").select("advertiser_name,title,description,instructions,verification_type,target_url,telegram_chat_id,button_label,reward,max_completions,priority,featured,internal_note").eq("id", id).single();
      if (source.error || !source.data) throw source.error || new Error("Кампания не найдена");
      const { data, error } = await supabase.from("sponsored_campaigns").insert({ ...source.data, title: `${source.data.title} — копия`, status: "draft", completed_count: 0, starts_at: null, ends_at: null, created_by: actor }).select("id").single();
      if (error) throw error;
      await audit(actor, "sponsor.clone", "sponsored_campaign", String(data.id), { sourceId: id });
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (action === "sponsor.delete") {
      const id = text(body.id, 80);
      if (!id) return NextResponse.json({ error: "Кампания не выбрана" }, { status: 400 });
      const current = await supabase.from("sponsored_campaigns").select("completed_count").eq("id", id).single();
      if (current.error || !current.data) throw current.error || new Error("Кампания не найдена");
      if (Number(current.data.completed_count||0)>0) return NextResponse.json({ error: "Кампанию с выполнениями нельзя удалить. Переведите её в статус «Завершена», чтобы сохранить историю." }, { status: 409 });
      const { error } = await supabase.from("sponsored_campaigns").delete().eq("id", id);
      if (error) throw error;
      await audit(actor, "sponsor.delete", "sponsored_campaign", id);
      return NextResponse.json({ ok: true });
    }

    if (action === "sponsor.review") {
      const claimId = text(body.claimId, 80);
      const approve = body.approve === true;
      const claim = await supabase.from("sponsored_task_claims").select("id,campaign_id,profile_id,status").eq("id", claimId).single();
      if (claim.error || !claim.data) throw claim.error || new Error("Заявка не найдена");
      if (claim.data.status === "claimed") return NextResponse.json({ ok: true, alreadyClaimed: true });
      if (approve) {
        const result = await supabase.rpc("claim_sponsored_campaign_v047", { p_profile_id: claim.data.profile_id, p_campaign_id: claim.data.campaign_id, p_verification_source: "admin_manual" });
        if (result.error) throw result.error;
        await supabase.from("sponsored_task_claims").update({ reviewed_by: actor, updated_at: new Date().toISOString() }).eq("id", claimId);
        await audit(actor, "sponsor.approve", "sponsored_claim", claimId, { campaignId: claim.data.campaign_id, profileId: claim.data.profile_id });
        return NextResponse.json({ ok: true, result: result.data });
      }
      const { error } = await supabase.from("sponsored_task_claims").update({ status: "rejected", reviewed_by: actor, updated_at: new Date().toISOString() }).eq("id", claimId);
      if (error) throw error;
      await audit(actor, "sponsor.reject", "sponsored_claim", claimId, { campaignId: claim.data.campaign_id, profileId: claim.data.profile_id });
      return NextResponse.json({ ok: true });
    }

    if (action === "promo.create") {
      const code = text(body.code, 32).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
      const reward = number(body.reward);
      const maxUses = Math.floor(number(body.maxUses) ?? 0);
      const note = text(body.note, 500);
      const startsAt = body.startsAt ? new Date(String(body.startsAt)).toISOString() : null;
      const endsAt = body.endsAt ? new Date(String(body.endsAt)).toISOString() : null;
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
      if (number(body.reward) != null) patch.reward = number(body.reward);
      if (number(body.maxUses) != null) patch.max_uses = Math.floor(number(body.maxUses)!);
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
      const reward = number(body.rewardedAdReward);
      const dailyLimit = Math.floor(number(body.rewardedAdDailyLimit) ?? -1);
      const cooldownMinutes = Math.floor(number(body.rewardedAdCooldownMinutes) ?? -1);
      const launchFee = number(body.coinLaunchFee);
      const launchCooldown = Math.floor(number(body.coinLaunchCooldownHours) ?? -1);
      const maxActive = Math.floor(number(body.coinMaxActive) ?? -1);
      const giftFeeBps = Math.floor(number(body.giftFeeBps) ?? -1);
      if (reward == null || reward < 1 || reward > 500 || dailyLimit < 0 || dailyLimit > 20 || cooldownMinutes < 0 || cooldownMinutes > 1440 || launchFee == null || launchFee < 0 || launchFee > 100000 || launchCooldown < 1 || launchCooldown > 168 || maxActive < 1 || maxActive > 20 || giftFeeBps < 0 || giftFeeBps > 1000) {
        return NextResponse.json({ error: "Некорректные параметры экономики" }, { status: 400 });
      }
      const patch = {
        rewarded_ad_reward: reward,
        rewarded_ad_daily_limit: dailyLimit,
        rewarded_ad_cooldown_minutes: cooldownMinutes,
        coin_launch_fee: launchFee,
        coin_launch_cooldown_hours: launchCooldown,
        coin_max_active: maxActive,
        gift_fee_bps: giftFeeBps,
        updated_at: new Date().toISOString(),
      };
      const settings = await supabase.rpc("update_economy_settings_v045", {
        p_rewarded_ad_reward: reward,
        p_rewarded_ad_daily_limit: dailyLimit,
        p_rewarded_ad_cooldown_minutes: cooldownMinutes,
        p_coin_launch_fee: launchFee,
        p_coin_launch_cooldown_hours: launchCooldown,
        p_coin_max_active: maxActive,
        p_gift_fee_bps: giftFeeBps,
      });
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
