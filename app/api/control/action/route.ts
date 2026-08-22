import { readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireLocalControl } from "@/lib/local-admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sameOriginMutation } from "@/lib/security";
import { syncGiftCatalog } from "@/lib/gift-catalog";
import { ensureNpcMarketLiquidity } from "@/lib/npc-market";

export const runtime = "nodejs";
const ACTOR = "local-god-mode";

function text(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max); }
function number(value: unknown) { const result = Number(value); return Number.isFinite(result) ? result : null; }

async function audit(action: string, targetType?: string, targetId?: string, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("admin_audit_log").insert({ actor: ACTOR, action, target_type: targetType || null, target_id: targetId || null, payload });
  if (error) console.error("local control audit", error);
}

async function POSTHandler(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = text(body.action, 80);
  const supabase = getSupabaseAdmin();

  try {
    if (action === "balance.adjust") {
      const profileId = text(body.profileId, 80);
      const delta = number(body.delta);
      if (!profileId || delta == null) return NextResponse.json({ error: "Укажите игрока и изменение баланса" }, { status: 400 });
      const { data, error } = await supabase.rpc("admin_adjust_balance", { p_profile_id: profileId, p_delta: delta, p_actor: ACTOR, p_reason: text(body.reason, 300) });
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
      const result = await supabase.rpc("admin_adjust_balance", { p_profile_id: profileId, p_delta: delta, p_actor: ACTOR, p_reason: text(body.reason, 300) || "Установлен точный баланс" });
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
      await audit("profile.set_xp", "profile", profileId, { xp });
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
      await audit("profile.moderate", "profile", profileId, patch);
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
      if (!key || !title || !description || !actionType || reward == null || reward < 0 || target < 1) return NextResponse.json({ error: "Заполните все поля задания" }, { status: 400 });
      const { data, error } = await supabase.from("missions").insert({ key, title, description, period, reward, target, action_type: actionType, sort_order: sortOrder, active: true }).select("id").single();
      if (error) throw error;
      await audit("mission.create", "mission", String(data.id), { key, title, period, reward, target, actionType });
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (action === "mission.update") {
      const id = text(body.id, 80);
      const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch.title = text(body.title, 120);
      if (body.description !== undefined) patch.description = text(body.description, 500);
      if (typeof body.period === "string" && ["onboarding", "daily", "weekly"].includes(body.period)) patch.period = body.period;
      if (number(body.reward) != null) patch.reward = number(body.reward);
      if (number(body.target) != null) patch.target = Math.max(1, Math.floor(number(body.target)!));
      if (body.actionType !== undefined) patch.action_type = text(body.actionType, 80);
      if (number(body.sortOrder) != null) patch.sort_order = Math.floor(number(body.sortOrder)!);
      if (typeof body.active === "boolean") patch.active = body.active;
      if (!id || !Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const { error } = await supabase.from("missions").update(patch).eq("id", id);
      if (error) throw error;
      await audit("mission.update", "mission", id, patch);
      return NextResponse.json({ ok: true });
    }

    if (action === "mission.delete") {
      const id = text(body.id, 80);
      if (!id) return NextResponse.json({ error: "Задание не выбрано" }, { status: 400 });
      const { error } = await supabase.from("missions").delete().eq("id", id);
      if (error) throw error;
      await audit("mission.delete", "mission", id);
      return NextResponse.json({ ok: true });
    }

    if (action === "coin.create") {
      const creatorProfileId = body.creatorProfileId ? text(body.creatorProfileId, 80) : null;
      const name = text(body.name, 32);
      const symbol = text(body.symbol, 8).toUpperCase();
      const description = text(body.description, 180);
      const imageUrl = body.imageUrl ? text(body.imageUrl, 1000) : null;
      const { data, error } = await supabase.rpc("admin_create_coin", { p_creator_profile_id: creatorProfileId, p_name: name, p_symbol: symbol, p_description: description, p_image_url: imageUrl, p_actor: ACTOR });
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
      await audit("coin.update", "coin", id, patch);
      return NextResponse.json({ ok: true });
    }

    if (action === "coin.delete") {
      const id = text(body.id, 80);
      if (!id) return NextResponse.json({ error: "Коин не выбран" }, { status: 400 });
      const { error } = await supabase.from("coins").delete().eq("id", id);
      if (error) throw error;
      await audit("coin.delete", "coin", id);
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
      await audit(price == null ? "gift.unlist" : "gift.list", "virtual_gift", id, { price });
      return NextResponse.json({ ok: true });
    }

    if (action === "gift.transfer") {
      const id = text(body.id, 80);
      const ownerProfileId = text(body.ownerProfileId, 80);
      if (!id || !ownerProfileId) return NextResponse.json({ error: "Выберите подарок и нового владельца" }, { status: 400 });
      const { error } = await supabase.rpc("admin_transfer_virtual_gift", { p_virtual_gift_id: id, p_owner_profile_id: ownerProfileId, p_actor: ACTOR });
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
      await audit("catalog.source.add", "gift_catalog_source", String(data.id), { telegramId, label });
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (action === "catalog.source.toggle") {
      const id = text(body.id, 80);
      if (!id || typeof body.active !== "boolean") return NextResponse.json({ error: "Некорректный источник" }, { status: 400 });
      const { error } = await supabase.from("gift_catalog_sources").update({ active: body.active, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      await audit("catalog.source.toggle", "gift_catalog_source", id, { active: body.active });
      return NextResponse.json({ ok: true });
    }

    if (action === "catalog.source.delete") {
      const id = text(body.id, 80);
      if (!id) return NextResponse.json({ error: "Источник не выбран" }, { status: 400 });
      const { error } = await supabase.from("gift_catalog_sources").delete().eq("id", id);
      if (error) throw error;
      await audit("catalog.source.delete", "gift_catalog_source", id);
      return NextResponse.json({ ok: true });
    }

    if (action === "catalog.sync") {
      const catalog = await syncGiftCatalog();
      const liquidity = await ensureNpcMarketLiquidity({ force: true, targetListings: 1000 });
      await audit("catalog.sync", "telegram_hybrid_catalog", undefined, { catalog, liquidity });
      return NextResponse.json({ ok: true, catalog, liquidity });
    }

    if (action === "npc.tick") {
      const result = await ensureNpcMarketLiquidity({ force: true, targetListings: Math.floor(number(body.targetListings) ?? 18) });
      await audit("npc.tick", "gift_liquidity", undefined, { result });
      return NextResponse.json({ ok: true, result });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    console.error("local control action", action, error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 400 });
  }
}
export const POST = withApiErrors("app/api/control/action/route.ts:POST", POSTHandler);
