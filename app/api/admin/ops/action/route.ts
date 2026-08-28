import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { invalidateRuntimeConfigCache, getRuntimeConfig, validateRuntimeConfigInput } from "@/lib/runtime-config";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";

function text(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max); }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }

async function audit(actor: string, action: string, targetType?: string, targetId?: string, payload: Record<string, unknown> = {}) {
  const { error } = await getSupabaseAdmin().from("admin_audit_log").insert({ actor, action, target_type: targetType || null, target_id: targetId || null, payload });
  if (error) console.error("admin ops audit", error);
}

async function saveRuntime(patch: (current: Awaited<ReturnType<typeof getRuntimeConfig>>) => unknown, actor: string, auditAction: string) {
  const current = await getRuntimeConfig();
  const next = validateRuntimeConfigInput(patch(current));
  const { error } = await getSupabaseAdmin().from("runtime_config_v056").update({
    maintenance_mode: next.maintenanceMode,
    maintenance_message: next.maintenanceMessage,
    feature_flags: next.featureFlags,
    remote_config: next.remoteConfig,
    updated_at: new Date().toISOString(),
  }).eq("singleton", true);
  if (error) throw error;
  invalidateRuntimeConfigCache();
  await audit(actor, auditAction, "runtime", "singleton", next as unknown as Record<string, unknown>);
  return next;
}

async function POSTHandler(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-ops", String(admin.id), 120, 60))) return NextResponse.json({ error: "Слишком много административных операций" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });

  const action = text(body.action, 80);
  const actor = `admin:${admin.telegram_id}`;
  const supabase = getSupabaseAdmin();

  try {
    if (action === "runtime.feature") {
      const feature = text(body.feature, 30) as "gifts" | "memecoins" | "referrals" | "stars";
      if (!(["gifts","memecoins","referrals","stars"] as string[]).includes(feature) || typeof body.enabled !== "boolean") return NextResponse.json({ error: "Некорректный feature flag" }, { status: 400 });
      const runtime = await saveRuntime((current) => ({ ...current, featureFlags: { ...current.featureFlags, [feature]: body.enabled } }), actor, "runtime.feature");
      return NextResponse.json({ ok: true, runtime });
    }

    if (action === "runtime.maintenance") {
      if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Укажите enabled" }, { status: 400 });
      const message = text(body.message, 240) || "Проводим технические работы. Попробуйте ещё раз чуть позже.";
      const runtime = await saveRuntime((current) => ({ ...current, maintenanceMode: body.enabled, maintenanceMessage: message }), actor, "runtime.maintenance");
      return NextResponse.json({ ok: true, runtime });
    }

    if (action === "profile.grant") {
      const profileId = text(body.profileId, 80);
      if (!validUuidLike(profileId)) return NextResponse.json({ error: "Некорректный профиль" }, { status: 400 });
      const balanceDelta = number(body.balanceDelta) ?? 0;
      const mxmDelta = Math.trunc(number(body.mxmDelta) ?? 0);
      const energyDelta = Math.trunc(number(body.energyDelta) ?? 0);
      const xpDelta = Math.trunc(number(body.xpDelta) ?? 0);
      if (![balanceDelta,mxmDelta,energyDelta,xpDelta].some((value) => value !== 0)) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const { data, error } = await supabase.rpc("admin_adjust_profile_resources_v075", {
        p_profile_id: profileId, p_balance_delta: balanceDelta, p_mxm_delta: mxmDelta, p_energy_delta: energyDelta, p_xp_delta: xpDelta,
      });
      if (error) throw error;
      await audit(actor, "profile.grant", "profile", profileId, { balanceDelta, mxmDelta, energyDelta, xpDelta, reason: text(body.reason, 300), result: data });
      return NextResponse.json({ ok: true, result: data });
    }

    if (action === "profile.moderate") {
      const profileId = text(body.profileId, 80);
      if (!validUuidLike(profileId)) return NextResponse.json({ error: "Некорректный профиль" }, { status: 400 });
      const patch: Record<string, unknown> = {};
      if (typeof body.isBanned === "boolean") patch.is_banned = body.isBanned;
      if (typeof body.hiddenFromLeaderboard === "boolean") patch.hidden_from_leaderboard = body.hiddenFromLeaderboard;
      if (body.banReason !== undefined) patch.ban_reason = text(body.banReason, 500) || null;
      if (!Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
      const { error } = await supabase.from("profiles").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", profileId);
      if (error) throw error;
      await audit(actor, "profile.moderate", "profile", profileId, patch);
      return NextResponse.json({ ok: true });
    }

    if (action === "notification.broadcast") {
      const audience = text(body.audience, 30);
      const title = text(body.title, 120);
      const message = text(body.body, 1000);
      if (!title || !message || !["all","active7d","premium","referrers"].includes(audience)) return NextResponse.json({ error: "Проверьте аудиторию и текст" }, { status: 400 });
      const dedupe = `admin-${Date.now()}-${String(admin.id).slice(0, 8)}`;
      const { data, error } = await supabase.rpc("admin_broadcast_notification_v075", { p_audience: audience, p_title: title, p_body: message, p_href: text(body.href, 500) || "/hub", p_dedupe_base: dedupe });
      if (error) throw error;
      await audit(actor, "notification.broadcast", "audience", audience, { title, href: text(body.href, 500) || "/hub", result: data });
      return NextResponse.json({ ok: true, result: data });
    }

    if (action === "notification.send") {
      const profileId = text(body.profileId, 80);
      const title = text(body.title, 120);
      const message = text(body.body, 1000);
      if (!validUuidLike(profileId) || !title || !message) return NextResponse.json({ error: "Проверьте профиль и текст" }, { status: 400 });
      const dedupe = `admin-direct-${Date.now()}-${profileId}`;
      const { data, error } = await supabase.rpc("create_notification_v074", { p_profile_id: profileId, p_kind: "admin", p_title: title, p_body: message, p_href: text(body.href, 500) || "/hub", p_metadata: { actor }, p_dedupe_key: dedupe });
      if (error) throw error;
      await audit(actor, "notification.send", "profile", profileId, { title, href: text(body.href, 500) || "/hub" });
      return NextResponse.json({ ok: true, id: data });
    }

    if (action === "store.toggle") {
      const sku = text(body.sku, 80);
      if (!sku || typeof body.active !== "boolean") return NextResponse.json({ error: "Некорректный товар" }, { status: 400 });
      const { data, error } = await supabase.from("store_products").update({ active: body.active, updated_at: new Date().toISOString() }).eq("sku", sku).select("sku,title,active").single();
      if (error) throw error;
      await audit(actor, "store.toggle", "store_product", sku, { active: body.active });
      return NextResponse.json({ ok: true, product: data });
    }

    if (action === "case.toggle") {
      const sku = text(body.sku, 80);
      if (!sku || typeof body.active !== "boolean") return NextResponse.json({ error: "Некорректный кейс" }, { status: 400 });
      const { data, error } = await supabase.from("case_definitions").update({ active: body.active }).eq("sku", sku).select("sku,title,active,remaining_supply").single();
      if (error) throw error;
      await audit(actor, "case.toggle", "case", sku, { active: body.active });
      return NextResponse.json({ ok: true, case: data });
    }

    if (action === "mission.bulk_status") {
      const period = body.period == null ? null : text(body.period, 20);
      if (period && !["onboarding","daily","weekly"].includes(period)) return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
      if (typeof body.active !== "boolean") return NextResponse.json({ error: "Укажите active" }, { status: 400 });
      let query = supabase.from("missions").update({ active: body.active, updated_at: new Date().toISOString() });
      if (period) query = query.eq("period", period);
      const { data, error } = await query.select("id");
      if (error) throw error;
      await audit(actor, "mission.bulk_status", "missions", period || "all", { active: body.active, affected: data?.length || 0 });
      return NextResponse.json({ ok: true, affected: data?.length || 0 });
    }

    if (action === "economy.update") {
      const bounds: Record<string, [number, number, boolean]> = {
        coin_launch_fee: [0, 100000, false], coin_launch_cooldown_hours: [0, 168, true], coin_max_active: [1, 100, true],
        gift_fee_bps: [0, 2000, true], referral_bonus_bps: [0, 5000, true], coin_total_fee_bps: [0, 2000, true],
        creator_lock_bps: [0, 10000, true], creator_lock_days: [0, 365, true], early_buyer_limit: [1, 1000, true], coin_launch_energy_cost: [0, 10000, true],
      };
      const patch: Record<string, number> = {};
      for (const [key, [min,max,integer]] of Object.entries(bounds)) {
        if (body[key] === undefined) continue;
        const value = number(body[key]);
        if (value == null || value < min || value > max || (integer && !Number.isInteger(value))) return NextResponse.json({ error: `${key}: допустимо ${min}..${max}` }, { status: 400 });
        patch[key] = value;
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: "Нет изменений экономики" }, { status: 400 });
      const { data, error } = await supabase.from("economy_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("singleton", true).select("*").single();
      if (error) throw error;
      await audit(actor, "economy.update", "economy", "singleton", patch);
      return NextResponse.json({ ok: true, economy: data });
    }

    if (action === "telegram.test") {
      const message = text(body.message, 300) || "MemeX Ops: Telegram Bot API работает.";
      await telegramBotApi("sendMessage", { chat_id: admin.telegram_id, text: message, disable_web_page_preview: true }, 6_000);
      await audit(actor, "telegram.test", "integration", "telegram", {});
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    console.error("admin ops action", action, error);
    return apiFailure(error, "Административная операция не выполнена", 400);
  }
}

export const POST = withApiErrors("app/api/admin/ops/action/route.ts:POST", POSTHandler);
