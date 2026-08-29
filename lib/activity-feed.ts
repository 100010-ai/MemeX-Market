import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityItem } from "@/lib/types";
import { resolveGiftImageUrl } from "@/lib/mappers";
import { finiteNumber, nonEmptyId, nullableNumber, safeIsoDate, text } from "@/lib/safe-data";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function getUnifiedMarketActivity(supabase: SupabaseClient, limit = 30): Promise<ActivityItem[]> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit || 30), 100));
  const { data, error } = await supabase.rpc("activity_feed_snapshot_v074", { p_limit: safeLimit });
  if (error) throw error;
  const root = object(data);
  const rows = Array.isArray(root.activity) ? root.activity : [];
  const activity: ActivityItem[] = [];

  for (const raw of rows) {
    const row = object(raw);
    const id = nonEmptyId(row.id);
    const eventKind = text(row.eventKind, "", 80);
    const createdAt = safeIsoDate(row.createdAt, "");
    if (!id || !eventKind || !createdAt) continue;

    const actorId = nonEmptyId(row.actorId);
    const actorName = text(row.actorName, "Удалённый игрок", 120);
    const amount = nullableNumber(row.amount);
    const metadata = object(row.metadata);
    const importance = Math.max(0, Math.min(100, Math.floor(finiteNumber(row.importance))));
    const coinId = nonEmptyId(row.coinId);
    const symbol = text(row.symbol, "", 24).toUpperCase();
    const giftId = nonEmptyId(row.virtualGiftId);
    const baseName = text(row.baseName, "", 120);
    const giftNumber = finiteNumber(row.giftNumber, NaN);
    const giftImage = giftId ? resolveGiftImageUrl({ virtual_gift_id: giftId, base_name: baseName, gift_number: giftNumber, model_preview_url: row.modelPreviewUrl, model_media_url: row.modelMediaUrl, symbol_media_url: row.symbolMediaUrl }) : null;
    const base = { id: `activity-${id}`, actorId, amount, createdAt, importance };
    let item: ActivityItem | null = null;

    if ((eventKind === "coin_buy" || eventKind === "coin_sell") && coinId && symbol) {
      item = { ...base, kind: "coin", label: `${actorName} ${eventKind === "coin_buy" ? "купил" : "продал"}`, detail: `$${symbol}`, href: `/coin/${coinId}`, imageUrl: typeof row.coinImageUrl === "string" ? row.coinImageUrl : null };
    } else if (eventKind === "coin_launch" && coinId && symbol) {
      item = { ...base, kind: "launch", label: `${actorName} запустил`, detail: `$${symbol}`, href: `/coin/${coinId}`, imageUrl: typeof row.coinImageUrl === "string" ? row.coinImageUrl : null };
    } else if (giftId && baseName && Number.isFinite(giftNumber)) {
      const detail = `${baseName} #${Math.floor(giftNumber)}`;
      if (eventKind === "gift_sale") item = { ...base, kind: "gift", label: `${actorName} купил`, detail, href: `/gifts/${giftId}`, imageUrl: giftImage };
      else if (eventKind === "gift_listed") item = { ...base, kind: "listing", label: `${actorName} выставил`, detail, href: `/gifts/${giftId}`, imageUrl: giftImage };
      else if (eventKind === "gift_repriced") item = { ...base, kind: "reprice", label: `${actorName} изменил цену`, detail, href: `/gifts/${giftId}`, imageUrl: giftImage };
      else if (eventKind === "gift_unlisted" || eventKind === "gift_expired") item = { ...base, kind: "unlist", label: eventKind === "gift_expired" ? `${actorName} · срок продажи истёк` : `${actorName} снял с продажи`, detail, href: `/gifts/${giftId}`, imageUrl: giftImage };
      else if (eventKind === "gift_offer") item = { ...base, kind: "offer", label: `${actorName} предложил цену`, detail, href: `/gifts/${giftId}`, imageUrl: giftImage };
      else if (eventKind === "trade_offer_created") item = { ...base, kind: "offer", label: `${actorName} предложил обмен`, detail, href: `/gifts/${giftId}`, imageUrl: giftImage };
      else if (eventKind === "trade_swap") item = { ...base, kind: "offer", label: `${actorName} завершил обмен`, detail, href: `/gifts/${giftId}`, imageUrl: giftImage };
    } else if (eventKind === "case_drop") {
      const rewardLabel = text(metadata.rewardLabel, "Редкая награда", 160);
      const rarity = text(metadata.rarity, "epic", 32);
      const serial = Math.max(0, Math.floor(finiteNumber(metadata.serialNumber)));
      item = { ...base, kind: "launch", label: `${actorName} выбил ${rarity === "legendary" ? "легендарную" : "эпическую"} награду`, detail: serial > 0 ? `${rewardLabel} · #${serial}` : rewardLabel, href: "/cases", imageUrl: null };
    }

    if (item) activity.push(item);
  }
  return activity;
}
