import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";
import { safeSecretEquals } from "@/lib/security";

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
    giftIds.length ? supabase.from("gift_market_overview").select("virtual_gift_id,listing_price,reference_price,collection_floor").in("virtual_gift_id", giftIds) : Promise.resolve({ data: [], error: null }),
    collections.length ? supabase.from("gift_collection_overview").select("base_name,floor_price").in("base_name", collections) : Promise.resolve({ data: [], error: null }),
  ]);
  const error = coinResult.error || giftResult.error || collectionResult.error;
  if (error) throw error;
  const coinRows = (coinResult.data || []) as DbRow[];
  const giftRows = (giftResult.data || []) as DbRow[];
  const collectionRows = (collectionResult.data || []) as DbRow[];
  const maps = {
    coins: new Map(coinRows.map((row) => [String(row.id), Number(row.current_price)])),
    gifts: new Map(giftRows.flatMap((row) => { const raw = row.listing_price ?? row.reference_price ?? row.collection_floor; return raw == null ? [] : [[String(row.virtual_gift_id), Number(raw)] as [string, number]]; })),
    collections: new Map(collectionRows.filter((row) => row.floor_price != null).map((row) => [String(row.base_name), Number(row.floor_price)])),
  };
  let triggered = 0;
  for (const row of rows) {
    const price = currentPrice(String(row.kind), row.kind === "coin" ? String(row.coin_id || "") : row.kind === "gift" ? String(row.virtual_gift_id || "") : null, row.gift_collection ? String(row.gift_collection) : null, maps);
    if (price == null || !Number.isFinite(price)) continue;
    const target = Number(row.target_price);
    const hit = row.direction === "below" ? price <= target : price >= target;
    if (hit && !row.is_triggered) {
      const label = row.kind === "gift_collection" ? String(row.gift_collection) : row.kind === "coin" ? `Мемкоин ${String(row.coin_id).slice(0, 8)}` : `Gift ${String(row.virtual_gift_id).slice(0, 8)}`;
      const href = row.kind === "gift_collection" ? `/collections/${encodeURIComponent(String(row.gift_collection))}` : row.kind === "coin" ? `/coin/${row.coin_id}` : `/gifts/${row.virtual_gift_id}`;
      const inserted = await supabase.from("user_notifications").insert({ profile_id: row.profile_id, kind: "price_alert", title: "Price alert сработал", body: `${label} · ${price.toLocaleString("ru-RU", { maximumFractionDigits: 4 })} TON`, href, metadata: { alertId: row.id, price, target, direction: row.direction } });
      if (!inserted.error) {
        await supabase.from("price_alerts").update({ is_triggered: true, last_triggered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
        triggered += 1;
      }
    } else if (!hit && row.is_triggered) {
      await supabase.from("price_alerts").update({ is_triggered: false, updated_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
  return triggered;
}

async function dispatchTelegram() {
  const supabase = getSupabaseAdmin();
  const pending = await supabase.from("user_notifications").select("id,profile_id,title,body,href").is("telegram_sent_at", null).order("created_at", { ascending: true }).limit(50);
  if (pending.error) throw pending.error;
  const rows = pending.data || [];
  if (!rows.length) return { sent: 0, failed: 0 };
  const profileIds = [...new Set(rows.map((r) => String(r.profile_id)))];
  const [profiles, prefs] = await Promise.all([
    supabase.from("profiles").select("id,telegram_id").in("id", profileIds),
    supabase.from("notification_preferences").select("profile_id,telegram_push").in("profile_id", profileIds),
  ]);
  if (profiles.error || prefs.error) throw profiles.error || prefs.error;
  const chats = new Map((profiles.data || []).map((p) => [String(p.id), Number(p.telegram_id)]));
  const allowed = new Map((prefs.data || []).map((p) => [String(p.profile_id), Boolean(p.telegram_push)]));
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || "https://meme-x-market.vercel.app").replace(/\/$/, "");
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    if (allowed.get(String(row.profile_id)) === false) {
      await supabase.from("user_notifications").update({ telegram_sent_at: new Date().toISOString(), telegram_error: "disabled" }).eq("id", row.id);
      continue;
    }
    const chatId = chats.get(String(row.profile_id));
    if (!chatId) continue;
    const text = `*${String(row.title).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1")}*${row.body ? `\n${String(row.body).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1")}` : ""}`;
    try {
      const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "MarkdownV2", disable_web_page_preview: true };
      if (appUrl && row.href) payload.reply_markup = { inline_keyboard: [[{ text: "Открыть в MXM", web_app: { url: `${appUrl}${row.href}` } }]] };
      await telegramBotApi("sendMessage", payload);
      await supabase.from("user_notifications").update({ telegram_sent_at: new Date().toISOString(), telegram_error: null }).eq("id", row.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      await supabase.from("user_notifications").update({ telegram_error: error instanceof Error ? error.message.slice(0, 500) : "telegram error" }).eq("id", row.id);
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dispatch failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
