import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityItem } from "@/lib/types";

type ProfileRef = { id?: string; username: string | null; first_name: string | null };
type CoinRef = { id?: string; name?: string; symbol: string };
type GiftRef = { virtual_gift_id?: string; base_name: string; gift_number: number | string };
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
  if (typeof profile?.username === "string" && profile.username.length) return `@${profile.username}`;
  if (typeof profile?.first_name === "string" && profile.first_name.length) return profile.first_name;
  return "Удалённый игрок";
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export async function getMarketActivity(supabase: SupabaseClient, limit = 30): Promise<ActivityItem[]> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit || 30), 100));
  const [coinTrades, giftTrades, events] = await Promise.all([
    supabase.from("trades").select("id,profile_id,coin_id,side,quote_amount,created_at,coins(symbol),profiles(username,first_name)").order("created_at", { ascending: false }).limit(safeLimit),
    supabase.from("gift_trades").select("id,virtual_gift_id,buyer_profile_id,price,created_at,gift_assets(base_name,gift_number),profiles!gift_trades_buyer_profile_id_fkey(username,first_name)").order("created_at", { ascending: false }).limit(safeLimit),
    supabase.from("market_events").select("id,actor_profile_id,kind,coin_id,virtual_gift_id,amount,created_at").order("created_at", { ascending: false }).limit(safeLimit),
  ]);
  const error = coinTrades.error || giftTrades.error || events.error;
  if (error) throw error;

  const coinTradeRows = rows<CoinTradeRow>(coinTrades.data);
  const giftTradeRows = rows<GiftTradeRow>(giftTrades.data);
  const eventRows = rows<MarketEventRow>(events.data);
  const actorIds = [...new Set(eventRows.flatMap((row) => row.actor_profile_id ? [row.actor_profile_id] : []))];
  const coinIds = [...new Set(eventRows.flatMap((row) => row.coin_id ? [row.coin_id] : []))];
  const giftIds = [...new Set(eventRows.flatMap((row) => row.virtual_gift_id ? [row.virtual_gift_id] : []))];

  const [actorsResult, eventCoinsResult, eventGiftsResult] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id,username,first_name").in("id", actorIds) : Promise.resolve({ data: [] as ActivityActorRow[], error: null }),
    coinIds.length ? supabase.from("coins").select("id,name,symbol").in("id", coinIds) : Promise.resolve({ data: [] as ActivityCoinRow[], error: null }),
    giftIds.length ? supabase.from("gift_market_overview").select("virtual_gift_id,base_name,gift_number").in("virtual_gift_id", giftIds) : Promise.resolve({ data: [] as ActivityGiftRow[], error: null }),
  ]);
  const lookupError = actorsResult.error || eventCoinsResult.error || eventGiftsResult.error;
  if (lookupError) throw lookupError;

  const actors = new Map(rows<ActivityActorRow>(actorsResult.data).map((row) => [String(row.id), displayName(row)]));
  const eventCoins = new Map(rows<ActivityCoinRow>(eventCoinsResult.data).map((row) => [String(row.id), row]));
  const eventGifts = new Map(rows<ActivityGiftRow>(eventGiftsResult.data).map((row) => [String(row.virtual_gift_id), row]));

  const items: ActivityItem[] = [];
  for (const row of coinTradeRows) {
    const coin = one<CoinRef>(row.coins);
    const user = one<ProfileRef>(row.profiles);
    if (!coin?.symbol) continue;
    items.push({
      id: `coin-${row.id}`,
      kind: "coin",
      actorId: String(row.profile_id),
      label: `${displayName(user)} ${row.side === "buy" ? "купил" : "продал"}`,
      detail: `$${coin.symbol}`,
      amount: Number(row.quote_amount),
      createdAt: String(row.created_at),
      href: `/coin/${row.coin_id}`,
    });
  }

  for (const row of giftTradeRows) {
    const gift = one<GiftRef>(row.gift_assets);
    const user = one<ProfileRef>(row.profiles);
    if (!gift?.base_name || !Number.isFinite(Number(gift.gift_number))) continue;
    items.push({
      id: `gift-${row.id}`,
      kind: "gift",
      actorId: String(row.buyer_profile_id),
      label: `${displayName(user)} купил`,
      detail: `${gift.base_name} #${Number(gift.gift_number)}`,
      amount: Number(row.price),
      createdAt: String(row.created_at),
      href: `/gifts/${row.virtual_gift_id}`,
    });
  }

  for (const row of eventRows) {
    const actorName = row.actor_profile_id ? actors.get(row.actor_profile_id) || "Удалённый игрок" : "Система";
    if (row.kind === "launch" && row.coin_id) {
      const coin = eventCoins.get(row.coin_id);
      if (!coin?.symbol) continue;
      items.push({ id: `event-${row.id}`, kind: "launch", actorId: row.actor_profile_id, label: `${actorName} запустил`, detail: `$${coin.symbol}`, amount: null, createdAt: String(row.created_at), href: `/coin/${row.coin_id}` });
    } else if (row.kind === "listing" && row.virtual_gift_id) {
      const gift = eventGifts.get(row.virtual_gift_id);
      if (!gift?.base_name || !Number.isFinite(Number(gift.gift_number))) continue;
      items.push({ id: `event-${row.id}`, kind: "listing", actorId: row.actor_profile_id, label: `${actorName} выставил`, detail: `${gift.base_name} #${Number(gift.gift_number)}`, amount: row.amount == null ? null : Number(row.amount), createdAt: String(row.created_at), href: `/gifts/${row.virtual_gift_id}` });
    } else if (row.kind === "offer" && row.virtual_gift_id) {
      // Null amount is a private offer-state refresh (cancel/reject). It should refresh
      // subscribers but must not create misleading public feed copy.
      if (row.amount == null) continue;
      const gift = eventGifts.get(row.virtual_gift_id);
      if (!gift?.base_name || !Number.isFinite(Number(gift.gift_number))) continue;
      items.push({ id: `event-${row.id}`, kind: "offer", actorId: row.actor_profile_id, label: `${actorName} предложил`, detail: `${gift.base_name} #${Number(gift.gift_number)}`, amount: Number(row.amount), createdAt: String(row.created_at), href: `/gifts/${row.virtual_gift_id}` });
    }
    // Unknown future event kinds are intentionally ignored instead of taking
    // down the whole feed after a schema extension.
  }

  return items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, safeLimit);
}
