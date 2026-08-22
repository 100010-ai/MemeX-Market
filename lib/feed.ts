import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityItem } from "@/lib/types";
import { resolveGiftImageUrl } from "@/lib/mappers";
import { nonEmptyId, nullableNumber, safeIsoDate, text } from "@/lib/safe-data";

type ProfileRef = { id?: string; username: string | null; first_name: string | null; is_system?: boolean | null };
type CoinRef = { id?: string; name?: string; symbol: string; image_url?: string | null };
type GiftRef = { virtual_gift_id?: string; base_name: string; gift_number: number | string; model_preview_url?: unknown; model_media_url?: unknown; symbol_media_url?: unknown };
type CoinTradeRow = {
  id: string;
  profile_id: string;
  coin_id: string;
  side: "buy" | "sell";
  quote_amount: number | string;
  created_at: string;
  coins: CoinRef | CoinRef[] | null;
  profiles: ProfileRef | ProfileRef[] | null;
};
type GiftTradeRow = {
  id: string;
  virtual_gift_id: string;
  buyer_profile_id: string;
  price: number | string;
  created_at: string;
  gift_assets: GiftRef | GiftRef[] | null;
  profiles: ProfileRef | ProfileRef[] | null;
};
type GiftListingEventRow = {
  id: string;
  actor_profile_id: string | null;
  virtual_gift_id: string;
  kind: "listed" | "repriced" | "unlisted" | "expired" | "sold" | "offer_accepted";
  price: number | string | null;
  previous_price: number | string | null;
  created_at: string;
};

type MarketEventRow = {
  id: string;
  actor_profile_id: string | null;
  kind: string;
  coin_id: string | null;
  virtual_gift_id: string | null;
  amount: number | string | null;
  created_at: string;
};

type ActivityActorRow = ProfileRef & { id: string };
type ActivityCoinRow = CoinRef & { id: string };
type ActivityGiftRow = GiftRef & { virtual_gift_id: string };

function one<T>(value: T | T[] | null | undefined): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function displayName(profile: ProfileRef | null | undefined) {
  const username = text(profile?.username, "", 64);
  if (username) return `@${username}`;
  return text(profile?.first_name, "Удалённый игрок", 120);
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export async function getMarketActivity(supabase: SupabaseClient, limit = 30): Promise<ActivityItem[]> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit || 30), 100));
  const [coinTrades, giftTrades, events, listingEvents] = await Promise.all([
    supabase.from("trades").select("id,profile_id,coin_id,side,quote_amount,created_at,coins(symbol,image_url),profiles(username,first_name,is_system)").order("created_at", { ascending: false }).limit(safeLimit),
    supabase.from("gift_trades").select("id,virtual_gift_id,buyer_profile_id,price,created_at,gift_assets(base_name,gift_number,model_preview_url,model_media_url,symbol_media_url),profiles!gift_trades_buyer_profile_id_fkey(username,first_name,is_system)").order("created_at", { ascending: false }).limit(safeLimit),
    supabase.from("market_events").select("id,actor_profile_id,kind,coin_id,virtual_gift_id,amount,created_at").order("created_at", { ascending: false }).limit(safeLimit),
    supabase.from("gift_listing_events").select("id,actor_profile_id,virtual_gift_id,kind,price,previous_price,created_at").order("created_at", { ascending: false }).limit(safeLimit),
  ]);
  const error = coinTrades.error || giftTrades.error || events.error || listingEvents.error;
  if (error) throw error;

  const coinTradeRows = rows<CoinTradeRow>(coinTrades.data);
  const giftTradeRows = rows<GiftTradeRow>(giftTrades.data);
  const eventRows = rows<MarketEventRow>(events.data);
  const listingRows = rows<GiftListingEventRow>(listingEvents.data);
  const actorIds = [...new Set([...eventRows, ...listingRows].flatMap((row) => { const id = nonEmptyId(row.actor_profile_id); return id ? [id] : []; }))];
  const coinIds = [...new Set(eventRows.flatMap((row) => { const id = nonEmptyId(row.coin_id); return id ? [id] : []; }))];
  const giftIds = [...new Set([
    ...eventRows.flatMap((row) => { const id = nonEmptyId(row.virtual_gift_id); return id ? [id] : []; }),
    ...listingRows.flatMap((row) => { const id = nonEmptyId(row.virtual_gift_id); return id ? [id] : []; }),
  ])];

  const [actorsResult, eventCoinsResult, eventGiftsResult] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id,username,first_name,is_system").in("id", actorIds) : Promise.resolve({ data: [] as ActivityActorRow[], error: null }),
    coinIds.length ? supabase.from("coins").select("id,name,symbol,image_url").in("id", coinIds) : Promise.resolve({ data: [] as ActivityCoinRow[], error: null }),
    giftIds.length ? supabase.from("gift_market_overview").select("virtual_gift_id,base_name,gift_number,model_preview_url,model_media_url,symbol_media_url").in("virtual_gift_id", giftIds) : Promise.resolve({ data: [] as ActivityGiftRow[], error: null }),
  ]);
  const lookupError = actorsResult.error || eventCoinsResult.error || eventGiftsResult.error;
  if (lookupError) throw lookupError;

  const actorRows = rows<ActivityActorRow>(actorsResult.data);
  const actors = new Map(actorRows.map((row) => [String(row.id), displayName(row)]));
  const systemActors = new Set(actorRows.filter((row) => row.is_system === true).map((row) => String(row.id)));
  const eventCoins = new Map(rows<ActivityCoinRow>(eventCoinsResult.data).map((row) => [String(row.id), row]));
  const eventGifts = new Map(rows<ActivityGiftRow>(eventGiftsResult.data).map((row) => [String(row.virtual_gift_id), row]));
  const detailedListingTimes = new Map<string, number[]>();
  for (const row of listingRows) {
    if (row.kind !== "listed" && row.kind !== "repriced") continue;
    const time = new Date(row.created_at).getTime();
    if (!Number.isFinite(time)) continue;
    const current = detailedListingTimes.get(row.virtual_gift_id) || [];
    current.push(time);
    detailedListingTimes.set(row.virtual_gift_id, current);
  }

  const items: ActivityItem[] = [];
  for (const row of coinTradeRows) {
    const coin = one<CoinRef>(row.coins);
    const user = one<ProfileRef>(row.profiles);
    const tradeId = nonEmptyId(row.id);
    const profileId = nonEmptyId(row.profile_id);
    const coinId = nonEmptyId(row.coin_id);
    const createdAt = safeIsoDate(row.created_at, "");
    if (!coin?.symbol || !tradeId || !profileId || !coinId || !createdAt || user?.is_system === true) continue;
    items.push({
      id: `coin-${tradeId}`,
      kind: "coin",
      actorId: profileId,
      label: `${displayName(user)} ${row.side === "buy" ? "купил" : "продал"}`,
      detail: `$${coin.symbol}`,
      amount: nullableNumber(row.quote_amount),
      createdAt,
      href: `/coin/${coinId}`,
      imageUrl: coin.image_url || null,
    });
  }

  for (const row of giftTradeRows) {
    const gift = one<GiftRef>(row.gift_assets);
    const user = one<ProfileRef>(row.profiles);
    const tradeId = nonEmptyId(row.id);
    const giftId = nonEmptyId(row.virtual_gift_id);
    const buyerId = nonEmptyId(row.buyer_profile_id);
    const createdAt = safeIsoDate(row.created_at, "");
    if (!gift?.base_name || !Number.isFinite(Number(gift.gift_number)) || !tradeId || !giftId || !buyerId || !createdAt || user?.is_system === true) continue;
    items.push({
      id: `gift-${tradeId}`,
      kind: "gift",
      actorId: buyerId,
      label: `${displayName(user)} купил`,
      detail: `${gift.base_name} #${Number(gift.gift_number)}`,
      amount: nullableNumber(row.price),
      createdAt,
      href: `/gifts/${giftId}`,
      imageUrl: resolveGiftImageUrl(gift),
    });
  }


  for (const row of listingRows) {
    const eventId = nonEmptyId(row.id);
    const virtualGiftId = nonEmptyId(row.virtual_gift_id);
    const createdAt = safeIsoDate(row.created_at, "");
    if (!eventId || !virtualGiftId || !createdAt) continue;
    const gift = eventGifts.get(virtualGiftId);
    if (!gift?.base_name || !Number.isFinite(Number(gift.gift_number))) continue;
    const actorId = nonEmptyId(row.actor_profile_id);
    if (actorId && systemActors.has(actorId)) continue;
    const actorName = actorId ? actors.get(actorId) || "Удалённый игрок" : "Система";
    const detail = `${gift.base_name} #${Number(gift.gift_number)}`;
    if (row.kind === "listed") {
      items.push({ id: `listing-${eventId}`, kind: "listing", actorId, label: `${actorName} выставил`, detail, amount: nullableNumber(row.price), createdAt, href: `/gifts/${virtualGiftId}`, imageUrl: resolveGiftImageUrl(gift) });
    } else if (row.kind === "repriced") {
      items.push({ id: `listing-${eventId}`, kind: "reprice", actorId, label: `${actorName} изменил цену`, detail, amount: nullableNumber(row.price), createdAt, href: `/gifts/${virtualGiftId}`, imageUrl: resolveGiftImageUrl(gift) });
    } else if (row.kind === "unlisted" || row.kind === "expired") {
      items.push({ id: `listing-${eventId}`, kind: "unlist", actorId, label: row.kind === "expired" ? `${actorName} · срок продажи истёк` : `${actorName} снял с продажи`, detail, amount: nullableNumber(row.previous_price), createdAt, href: `/gifts/${virtualGiftId}`, imageUrl: resolveGiftImageUrl(gift) });
    }
    // Sales are already represented by gift_trades, and accepted offers become
    // trades as well. Ignoring them here prevents duplicate public feed rows.
  }

  for (const row of eventRows) {
    const eventId = nonEmptyId(row.id);
    const actorId = nonEmptyId(row.actor_profile_id);
    if (actorId && systemActors.has(actorId)) continue;
    const createdAt = safeIsoDate(row.created_at, "");
    if (!eventId || !createdAt) continue;
    const actorName = actorId ? actors.get(actorId) || "Удалённый игрок" : "Система";
    const coinId = nonEmptyId(row.coin_id);
    const virtualGiftId = nonEmptyId(row.virtual_gift_id);
    if (row.kind === "launch" && coinId) {
      const coin = eventCoins.get(coinId);
      if (!coin?.symbol) continue;
      items.push({ id: `event-${eventId}`, kind: "launch", actorId, label: `${actorName} запустил`, detail: `$${coin.symbol}`, amount: null, createdAt, href: `/coin/${coinId}`, imageUrl: coin.image_url || null });
    } else if (row.kind === "listing" && virtualGiftId) {
      // Modern list_virtual_gift_v2 writes both market_events and the richer
      // gift_listing_events row. Keep market_events only for legacy/NPC rows
      // that have no detailed event, otherwise the public Feed shows doubles.
      const eventTime = new Date(createdAt).getTime();
      const hasDetailedTwin = (detailedListingTimes.get(virtualGiftId) || []).some((time) => Math.abs(time - eventTime) <= 10_000);
      if (hasDetailedTwin) continue;
      const gift = eventGifts.get(virtualGiftId);
      if (!gift?.base_name || !Number.isFinite(Number(gift.gift_number))) continue;
      items.push({ id: `event-${eventId}`, kind: "listing", actorId, label: `${actorName} выставил`, detail: `${gift.base_name} #${Number(gift.gift_number)}`, amount: nullableNumber(row.amount), createdAt, href: `/gifts/${virtualGiftId}`, imageUrl: resolveGiftImageUrl(gift) });
    } else if (row.kind === "offer" && virtualGiftId) {
      // Null amount is a private offer-state refresh (cancel/reject). It should refresh
      // subscribers but must not create misleading public feed copy.
      const amount = nullableNumber(row.amount);
      if (amount == null) continue;
      const gift = eventGifts.get(virtualGiftId);
      if (!gift?.base_name || !Number.isFinite(Number(gift.gift_number))) continue;
      items.push({ id: `event-${eventId}`, kind: "offer", actorId, label: `${actorName} предложил`, detail: `${gift.base_name} #${Number(gift.gift_number)}`, amount, createdAt, href: `/gifts/${virtualGiftId}`, imageUrl: resolveGiftImageUrl(gift) });
    }
    // Unknown future event kinds are intentionally ignored instead of taking
    // down the whole feed after a schema extension.
  }

  return items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, safeLimit);
}
