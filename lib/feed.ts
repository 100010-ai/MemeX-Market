import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityItem } from "@/lib/types";

function one<T>(value: T | T[] | null | undefined, label: string): T {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) throw new Error(`${label} relation is missing`);
  return row;
}

function displayName(profile: any) {
  if (typeof profile?.username === "string" && profile.username.length) return `@${profile.username}`;
  if (typeof profile?.first_name === "string" && profile.first_name.length) return profile.first_name;
  throw new Error("Market activity profile has no display name");
}

function rows(value: unknown, label: string): any[] {
  if (!Array.isArray(value)) throw new Error(`${label} query returned invalid data`);
  return value;
}

export async function getMarketActivity(supabase: SupabaseClient, limit = 30): Promise<ActivityItem[]> {
  const [coinTrades, giftTrades, events] = await Promise.all([
    supabase.from("trades").select("id,profile_id,coin_id,side,quote_amount,created_at,coins(symbol),profiles(username,first_name)").order("created_at", { ascending: false }).limit(limit),
    supabase.from("gift_trades").select("id,virtual_gift_id,buyer_profile_id,price,created_at,gift_assets(base_name,gift_number),profiles!gift_trades_buyer_profile_id_fkey(username,first_name)").order("created_at", { ascending: false }).limit(limit),
    supabase.from("market_events").select("id,actor_profile_id,kind,coin_id,virtual_gift_id,amount,created_at").order("created_at", { ascending: false }).limit(limit),
  ]);
  const error = coinTrades.error || giftTrades.error || events.error;
  if (error) throw error;

  const coinTradeRows = rows(coinTrades.data, "Coin trades");
  const giftTradeRows = rows(giftTrades.data, "Gift trades");
  const eventRows = rows(events.data, "Market events");
  const actorIds = [...new Set(eventRows.map((row: any) => String(row.actor_profile_id)))];
  const coinIds = [...new Set(eventRows.filter((row: any) => row.coin_id != null).map((row: any) => String(row.coin_id)))];
  const giftIds = [...new Set(eventRows.filter((row: any) => row.virtual_gift_id != null).map((row: any) => String(row.virtual_gift_id)))];

  const [actorsResult, eventCoinsResult, eventGiftsResult] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id,username,first_name").in("id", actorIds) : Promise.resolve({ data: [] as any[], error: null }),
    coinIds.length ? supabase.from("coins").select("id,name,symbol").in("id", coinIds) : Promise.resolve({ data: [] as any[], error: null }),
    giftIds.length ? supabase.from("gift_market_overview").select("virtual_gift_id,base_name,gift_number").in("virtual_gift_id", giftIds) : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  const lookupError = actorsResult.error || eventCoinsResult.error || eventGiftsResult.error;
  if (lookupError) throw lookupError;

  const actors = new Map(rows(actorsResult.data, "Activity actors").map((row: any) => [String(row.id), displayName(row)]));
  const eventCoins = new Map(rows(eventCoinsResult.data, "Activity coins").map((row: any) => [String(row.id), row]));
  const eventGifts = new Map(rows(eventGiftsResult.data, "Activity Gifts").map((row: any) => [String(row.virtual_gift_id), row]));

  const items: ActivityItem[] = [];
  for (const row of coinTradeRows) {
    const coin = one<any>(row.coins, "Coin trade coin");
    const user = one<any>(row.profiles, "Coin trade profile");
    if (row.side !== "buy" && row.side !== "sell") throw new Error("Coin trade has invalid side");
    if (typeof coin.symbol !== "string" || !coin.symbol) throw new Error("Coin trade symbol is missing");
    items.push({
      id: `coin-${row.id}`,
      kind: "coin",
      actorId: String(row.profile_id),
      label: `${displayName(user)} ${row.side === "buy" ? "bought" : "sold"}`,
      detail: `$${coin.symbol}`,
      amount: Number(row.quote_amount),
      createdAt: String(row.created_at),
      href: `/coin/${row.coin_id}`,
    });
  }

  for (const row of giftTradeRows) {
    const gift = one<any>(row.gift_assets, "Gift trade asset");
    const user = one<any>(row.profiles, "Gift trade buyer");
    if (typeof gift.base_name !== "string" || !gift.base_name || !Number.isFinite(Number(gift.gift_number))) throw new Error("Gift trade metadata is incomplete");
    items.push({
      id: `gift-${row.id}`,
      kind: "gift",
      actorId: String(row.buyer_profile_id),
      label: `${displayName(user)} bought`,
      detail: `${gift.base_name} #${Number(gift.gift_number)}`,
      amount: Number(row.price),
      createdAt: String(row.created_at),
      href: `/gifts/${row.virtual_gift_id}`,
    });
  }

  for (const row of eventRows) {
    const actorName = actors.get(String(row.actor_profile_id));
    if (!actorName) throw new Error(`Market event ${row.id} actor is missing`);
    if (row.kind === "launch") {
      const coin = eventCoins.get(String(row.coin_id));
      if (!coin || typeof coin.symbol !== "string" || !coin.symbol) throw new Error(`Market event ${row.id} coin is missing`);
      items.push({ id: `event-${row.id}`, kind: "launch", actorId: String(row.actor_profile_id), label: `${actorName} launched`, detail: `$${coin.symbol}`, amount: null, createdAt: String(row.created_at), href: `/coin/${row.coin_id}` });
    } else if (row.kind === "listing") {
      const gift = eventGifts.get(String(row.virtual_gift_id));
      if (!gift || typeof gift.base_name !== "string" || !gift.base_name) throw new Error(`Market event ${row.id} Gift is missing`);
      items.push({ id: `event-${row.id}`, kind: "listing", actorId: String(row.actor_profile_id), label: `${actorName} listed`, detail: `${gift.base_name} #${Number(gift.gift_number)}`, amount: row.amount == null ? null : Number(row.amount), createdAt: String(row.created_at), href: `/gifts/${row.virtual_gift_id}` });
    } else if (row.kind === "offer") {
      // Null amount is a private offer-state refresh (cancel/reject). It should refresh
      // subscribers but must not create misleading public feed copy.
      if (row.amount == null) continue;
      const gift = eventGifts.get(String(row.virtual_gift_id));
      if (!gift || typeof gift.base_name !== "string" || !gift.base_name) throw new Error(`Market event ${row.id} Gift is missing`);
      items.push({ id: `event-${row.id}`, kind: "offer", actorId: String(row.actor_profile_id), label: `${actorName} offered`, detail: `${gift.base_name} #${Number(gift.gift_number)}`, amount: Number(row.amount), createdAt: String(row.created_at), href: `/gifts/${row.virtual_gift_id}` });
    } else {
      throw new Error(`Unsupported market event kind: ${row.kind}`);
    }
  }

  return items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, limit);
}
