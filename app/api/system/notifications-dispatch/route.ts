import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";
import { safeSecretEquals } from "@/lib/security";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

type DbRow = Record<string, unknown>;
type PendingNotification = { id: string; profile_id: string; title: string; body: string | null; href: string | null };

function authorized(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return safeSecretEquals(bearer, secret) || safeSecretEquals(request.headers.get("x-mxm-cron-secret") || "", secret);
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function currentPrice(
  kind: string,
  id: string | null,
  collection: string | null,
  maps: { coins: Map<string, number>; gifts: Map<string, number>; collections: Map<string, number> },
) {
  if (kind === "coin" && id) return maps.coins.get(id) ?? null;
  if (kind === "gift" && id) return maps.gifts.get(id) ?? null;
  if (kind === "gift_collection" && collection) return maps.collections.get(collection) ?? null;
  return null;
}

async function evaluatePriceAlerts() {
  const supabase = getSupabaseAdmin();
  const alerts = await supabase
    .from("price_alerts")
    .select("id,profile_id,kind,coin_id,virtual_gift_id,gift_collection,direction,target_price,is_triggered")
    .eq("enabled", true)
    .limit(300);
  if (alerts.error) throw alerts.error;

  const rows = (alerts.data || []) as DbRow[];
  if (!rows.length) return { triggered: 0, failed: 0 };

  const coinIds = [...new Set(rows.filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)))];
  const giftIds = [...new Set(rows.filter((row) => row.kind === "gift" && row.virtual_gift_id).map((row) => String(row.virtual_gift_id)))];
  const collections = [...new Set(rows.filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)))];

  const [coinResult, giftResult, collectionResult] = await Promise.all([
    coinIds.length
      ? supabase.from("coins").select("id,current_price").in("id", coinIds)
      : Promise.resolve({ data: [], error: null }),
    giftIds.length
      ? supabase.from("gift_market_overview").select("virtual_gift_id,listing_price,reference_price_ton,collection_floor").in("virtual_gift_id", giftIds)
      : Promise.resolve({ data: [], error: null }),
    collections.length
      ? supabase.from("gift_collection_overview").select("base_name,floor_price").in("base_name", collections)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const priceError = coinResult.error || giftResult.error || collectionResult.error;
  if (priceError) throw priceError;

  const coinRows = (coinResult.data || []) as DbRow[];
  const giftRows = (giftResult.data || []) as DbRow[];
  const collectionRows = (collectionResult.data || []) as DbRow[];
  const maps = {
    coins: new Map<string, number>(coinRows.flatMap((row) => {
      const price = finiteNumber(row.current_price);
      return row.id && price != null ? [[String(row.id), price] as [string, number]] : [];
    })),
    gifts: new Map<string, number>(giftRows.flatMap((row) => {
      const raw = row.listing_price ?? row.reference_price_ton ?? row.collection_floor;
      const price = finiteNumber(raw);
      return row.virtual_gift_id && price != null ? [[String(row.virtual_gift_id), price] as [string, number]] : [];
    })),
    collections: new Map<string, number>(collectionRows.flatMap((row) => {
      const floor = finiteNumber(row.floor_price);
      return row.base_name && floor != null ? [[String(row.base_name), floor] as [string, number]] : [];
    })),
  };

  let triggered = 0;
  let failed = 0;
  const queue = [...rows];
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift();
      if (!row) return;
      try {
        const kind = String(row.kind || "");
        const id = kind === "coin"
          ? String(row.coin_id || "")
          : kind === "gift"
            ? String(row.virtual_gift_id || "")
            : null;
        const collection = row.gift_collection ? String(row.gift_collection) : null;
        const price = currentPrice(kind, id, collection, maps);
        const target = finiteNumber(row.target_price);
        if (price == null || target == null) continue;

        const hit = row.direction === "below" ? price <= target : price >= target;
        if (!((hit && !row.is_triggered) || (!hit && row.is_triggered))) continue;

        const label = kind === "gift_collection"
          ? String(row.gift_collection || "Коллекция")
          : kind === "coin"
            ? `Мемкоин ${String(row.coin_id || "").slice(0, 8)}`
            : `Подарок ${String(row.virtual_gift_id || "").slice(0, 8)}`;
        const href = kind === "gift_collection"
          ? `/collections/${encodeURIComponent(String(row.gift_collection || ""))}`
          : kind === "coin"
            ? `/coin/${String(row.coin_id || "")}`
            : `/gifts/${String(row.virtual_gift_id || "")}`;

        const transition = await supabase.rpc("process_price_alert_transition_v300", {
          p_alert_id: row.id,
          p_price: price,
          p_hit: hit,
          p_title: "Ценовое уведомление сработало",
          p_body: `${label} · ${price.toLocaleString("ru-RU", { maximumFractionDigits: 4 })} TON`,
          p_href: href,
          p_metadata: { source: "notifications_dispatch" },
        });
        if (transition.error) throw transition.error;
        if (transition.data === "triggered") triggered += 1;
      } catch (error) {
        failed += 1;
        console.warn("price alert evaluation item failed", { alertId: row.id, error });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, () => worker()));
  return { triggered, failed };
}

async function dispatchTelegram() {
  const supabase = getSupabaseAdmin();
  const claimToken = crypto.randomUUID();
  const pending = await supabase.rpc("claim_pending_notifications_v300", { p_claim_token: claimToken, p_limit: 50 });
  if (pending.error) throw pending.error;

  const rows = (pending.data || []) as PendingNotification[];
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
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await supabase
        .from("user_notifications")
        .update({ ...values, telegram_claim_token: null, telegram_claimed_at: null })
        .eq("id", id)
        .eq("telegram_claim_token", claimToken)
        .select("id")
        .maybeSingle();
      if (!result.error && result.data) return;
      lastError = result.error || new Error("Notification claim was lost before completion");
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
    throw lastError instanceof Error ? lastError : new Error("Notification delivery state could not be saved");
  };

  const escapeMarkdownV2 = (value: unknown) => String(value || "").replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
  const queue = [...rows];
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift();
      if (!row) return;
      const profileId = String(row.profile_id);

      if (allowed.get(profileId) === false) {
        try {
          await complete(row.id, { telegram_sent_at: new Date().toISOString(), telegram_error: "disabled" });
        } catch (error) {
          failed += 1;
          console.error("notification disabled state update failed", { notificationId: row.id, error });
        }
        continue;
      }
      const chatId = chats.get(profileId);
      if (!Number.isSafeInteger(chatId) || Number(chatId) <= 0) {
        try {
          await complete(row.id, { telegram_sent_at: new Date().toISOString(), telegram_error: "missing_chat_id" });
        } catch (error) {
          failed += 1;
          console.error("notification missing chat state update failed", { notificationId: row.id, error });
        }
        continue;
      }

      const text = `*${escapeMarkdownV2(row.title)}*${row.body ? `\n${escapeMarkdownV2(row.body)}` : ""}`;
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      };
      if (appUrl && row.href?.startsWith("/")) {
        payload.reply_markup = {
          inline_keyboard: [[{ text: "Открыть в MXM", web_app: { url: `${appUrl}${row.href}` } }]],
        };
      }

      try {
        await telegramBotApi("sendMessage", payload);
      } catch (error) {
        failed += 1;
        try {
          await complete(row.id, { telegram_error: error instanceof Error ? error.message.slice(0, 500) : "telegram error" });
        } catch (stateError) {
          console.error("notification delivery failure state", { notificationId: row.id, stateError });
        }
        continue;
      }

      try {
        await complete(row.id, { telegram_sent_at: new Date().toISOString(), telegram_error: null });
        sent += 1;
      } catch (error) {
        // Telegram already accepted this message. Never release the claim on a
        // state-write failure, otherwise the next cron run could immediately
        // send the same notification a second time. The claim remains visible
        // for operational recovery and completion is retried above.
        failed += 1;
        console.error("notification sent but completion state failed", { notificationId: row.id, error });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, () => worker()));
  return { sent, failed };
}

async function handler(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  try {
    const priceAlerts = await evaluatePriceAlerts();
    const telegram = await dispatchTelegram();
    return NextResponse.json({ ok: true, priceAlerts: priceAlerts.triggered, alertFailures: priceAlerts.failed, ...telegram, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("notifications dispatch", error);
    return apiFailure(error, "Не удалось обработать уведомления");
  }
}

export const GET = withApiErrors("app/api/system/notifications-dispatch/route.ts:GET", handler);
export const POST = withApiErrors("app/api/system/notifications-dispatch/route.ts:POST", handler);
