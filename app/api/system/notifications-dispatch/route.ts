import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";
import { safeSecretEquals } from "@/lib/security";
import crypto from "node:crypto";

type DbRow = Record<string, unknown>;

function authorized(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return safeSecretEquals(bearer, secret) || safeSecretEquals(request.headers.get("x-mxm-cron-secret") || "", secret);
}

function currentPrice(kind: string, id: string | null, collection: string | null, maps: { coins: Map<string, number>; gifts: Map<string, number>; collections: Map<string, number> }) {
  if (kind === "coin" && id) return maps.coins.get(id) ?? null;
  if (kind === "gift" && id) return maps.gifts.get(id) ?? null;
  if (kind === "gift_collection" && collection) return maps.collections.get(collection) ?? null;
  return null;
}

async function evaluatePriceAlerts() {
  const supabase = getSupabaseAdmin();
  const alerts = await supabase.from("price_alerts").select("id,profile_id,kind,coin_id,virtual_gift_id,gift_collection,direction,target_price,is_triggered").eq("enabled", true).limit(300);
  if (alerts.error) throw alerts.error;
  const rows = alerts.data || [];
  if (!rows.length) return 0;
  const coinIds = [...new Set(rows.filter((r) => r.kind === "coin" && r.coin_id).map((r) => String(r.coin_id)))];
  const giftIds = [...new Set(rows.filter((r) => r.kind === "gift" && r.virtual_gift_id).map((r) => String(r.virtual_gift_id)))];
  const collections = [...new Set(rows.filter((r) => r.kind === "gift_collection" && r.gift_collection).map((r) => String(r.gift_collection)))];
  const [coinResult, giftResult, collectionResult] = await Promise.all([
    coinIds.length ? supabase.from("coins").select("id,current_price").in("id", coinIds) : Promise.resolve({ data: [], error: null }),
    giftIds.length ? supabase.from("gift_market_overview").select("virtual_gift_id,listing_price,reference_price_ton,collection_floor").in("virtual_gift_id", giftIds) : Promise.resolve({ data: [], error: null }),
    collections.length ? supabase.from("gift_collection_overview").select("base_name,floor_price").in("base_name", collections) : Promise.resolve({ data: [], error: null }),
  ]);
  const error = coinResult.error || giftResult.error || collectionResult.error;
  if (error) throw error;
  const coinRows = (coinResult.data || []) as DbRow[];
  const giftRows = (giftResult.data || []) as DbRow[];
  const collectionRows = (collectionResult.data || []) as DbRow[];
  const maps = {
    coins: new Map(coinRows.map((row) => [String(row.id), Number(row.current_price)])),
    gifts: new Map(giftRows.flatMap((row) => { const raw = row.listing_price ?? row.reference_price_ton ?? row.collection_floor; return raw == null ? [] : [[String(row.virtual_gift_id), Number(raw)] as [string, number]]; })),
    collections: new Map(collectionRows.filter((row) => row.floor_price != null).map((row) => [String(row.base_name), Number(row.floor_price)])),
  };
  let triggered = 0;
  for (const row of rows) {
    const price = currentPrice(String(row.kind), row.kind === "coin" ? String(row.coin_id || "") : row.kind === "gift" ? String(row.virtual_gift_id || "") : null, row.gift_collection ? String(row.gift_collection) : null, maps);
    if (price == null || !Number.isFinite(price)) continue;
    const target = Number(row.target_price);
    const hit = row.direction === "below" ? price <= target : price >= target;
    if ((hit && !row.is_triggered) || (!hit && row.is_triggered)) {
      const label = row.kind === "gift_collection" ? String(row.gift_collection) : row.kind === "coin" ? `Мемкоин ${String(row.coin_id).slice(0, 8)}` : `Gift ${String(row.virtual_gift_id).slice(0, 8)}`;
      const href = row.kind === "gift_collection" ? `/collections/${encodeURIComponent(String(row.gift_collection))}` : row.kind === "coin" ? `/coin/${row.coin_id}` : `/gifts/${row.virtual_gift_id}`;
      const transition = await supabase.rpc("process_price_alert_transition_v300", {
        p_alert_id: row.id,
        p_price: price,
        p_hit: hit,
        p_title: "Price alert сработал",
        p_body: `${label} · ${price.toLocaleString("ru-RU", { maximumFractionDigits: 4 })} TON`,
        p_href: href,
        p_metadata: { source: "notifications_dispatch" },
      });
      if (transition.error) throw transition.error;
      if (transition.data === "triggered") triggered += 1;
    }
  }
  return triggered;
}

async function dispatchTelegram() {
  const supabase = getSupabaseAdmin();
  const claimToken = crypto.randomUUID();
  const pending = await supabase.rpc("claim_pending_notifications_v300", { p_claim_token: claimToken, p_limit: 50 });
  if (pending.error) throw pending.error;
  const rows = (pending.data || []) as Array<{ id: string; profile_id: string; title: string; body: string | null; href: string | null }>;
  if (!rows.length) return { sent: 0, failed: 0 };

  const profileIds = [...new Set(rows.map((row) => String(row.profile_id)).filter(Boolean))];
  const [profiles, prefs] = await Promise.all([
    supabase.from("profiles").select("id,telegram_id").in("id", profileIds),
    supabase.from("notification_preferences").select("profile_id,telegram_push").in("profile_id", profileIds),
  ]);
  if (profiles.error || prefs.error) throw profiles.error || prefs.error;

  const chats = new Map((profiles.data || []).map((profile) => [String(profile.id), Number(profile.telegram_id)]));
  const allowed = new Map((prefs.data || []).map((preference) => [String(preference.profile_id), Boolean(preference.telegram_push)]));
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || "").replace(/\/$/, "");
  let sent = 0;
  let failed = 0;

  const complete = async (id: string, values: Record<string, unknown>) => {
    const result = await supabase.from("user_notifications").update({ ...values, telegram_claim_token: null, telegram_claimed_at: null })
      .eq("id", id).eq("telegram_claim_token", claimToken);
    if (result.error) throw result.error;
  };

  for (const row of rows) {
    const profileId = String(row.profile_id);
    if (allowed.get(profileId) === false) {
      await complete(row.id, { telegram_sent_at: new Date().toISOString(), telegram_error: "disabled" });
      continue;
    }
    const chatId = chats.get(profileId);
    if (!Number.isSafeInteger(chatId) || Number(chatId) <= 0) {
      await complete(row.id, { telegram_sent_at: new Date().toISOString(), telegram_error: "missing_chat_id" });
      continue;
    }

    const escape = (value: unknown) => String(value || "").replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
    const text = `*${escape(row.title)}*${row.body ? `\n${escape(row.body)}` : ""}`;
    try {
      const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "MarkdownV2", disable_web_page_preview: true };
      if (appUrl && row.href && row.href.startsWith("/")) payload.reply_markup = { inline_keyboard: [[{ text: "Открыть в MXM", web_app: { url: `${appUrl}${row.href}` } }]] };
      await telegramBotApi("sendMessage", payload);
      await complete(row.id, { telegram_sent_at: new Date().toISOString(), telegram_error: null });
      sent += 1;
    } catch (error) {
      failed += 1;
      const failedUpdate = await supabase.from("user_notifications").update({
        telegram_error: error instanceof Error ? error.message.slice(0, 500) : "telegram error",
      }).eq("id", row.id).eq("telegram_claim_token", claimToken);
      if (failedUpdate.error) console.error("notification delivery failure state", failedUpdate.error);
    }
  }
  return { sent, failed };
}

async function handler(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const priceAlerts = await evaluatePriceAlerts();
    const telegram = await dispatchTelegram();
    return NextResponse.json({ ok: true, priceAlerts, ...telegram, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("notifications dispatch", error);
    return apiFailure(error, "Не удалось обработать уведомления");
  }
}

export const GET = withApiErrors("app/api/system/notifications-dispatch/route.ts:GET", handler);
export const POST = withApiErrors("app/api/system/notifications-dispatch/route.ts:POST", handler);
