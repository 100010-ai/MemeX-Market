import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getProfileSnapshot, requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoinPulse } from "@/lib/coin-pulse";
import { mapCoin } from "@/lib/mappers";
import { validUuidLike } from "@/lib/security";
import { finiteNumber, safeIsoDate } from "@/lib/safe-data";

type DbRow = Record<string, unknown>;

function relationOne(value: unknown, _label: string): DbRow {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return {};
  return row as DbRow;
}

function profileName(row: DbRow) {
  if (typeof row.username === "string" && row.username.length) return `@${row.username}`;
  if (typeof row.first_name === "string" && row.first_name.length) return row.first_name;
  return "Пользователь";
}

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный идентификатор мемкоина" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  try {
    const [coinResult, candleResult, tradeResult, holdingResult, topHoldersResult, watchedResult, profileSnapshot, economyResult, pulseResult, milestoneResult] = await Promise.all([
      supabase.from("market_overview").select("id,creator_profile_id,name,symbol,image_url,description,current_price,market_cap,volume_24h,change_24h,holder_count,trade_count_24h,created_at,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,total_supply,token_reserve,quote_reserve").eq("id", id).single(),
      supabase.from("candles").select("bucket_start,open,high,low,close,volume").eq("coin_id", id).order("bucket_start", { ascending: false }).limit(480),
      supabase.from("trades").select("id,profile_id,side,quote_amount,token_amount,price,created_at,profiles(username,first_name)").eq("coin_id", id).eq("is_launch_seed", false).order("created_at", { ascending: false }).limit(30),
      supabase.from("holdings").select("quantity,cost_basis").eq("coin_id", id).eq("profile_id", profile.id).maybeSingle(),
      supabase.from("holdings").select("profile_id,quantity,profiles(username,first_name)").eq("coin_id", id).gt("quantity", 0).order("quantity", { ascending: false }).limit(10),
      supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "coin").eq("coin_id", id).maybeSingle(),
      getProfileSnapshot(profile as Record<string, unknown>),
      supabase.rpc("coin_economy_snapshot_v200", { p_profile_id: profile.id, p_coin_id: id }),
      supabase.rpc("coin_pulse_snapshot_v0780", { p_coin_id: id, p_profile_id: profile.id }),
      supabase.from("coin_milestones_v078").select("id,kind,actor_profile_id,amount,metadata,created_at,profiles(username,first_name)").eq("coin_id", id).order("created_at", { ascending: false }).limit(24),
    ]);
    if (coinResult.error || !coinResult.data) return NextResponse.json({ error: "Мемкоин не найден" }, { status: 404 });
    const otherError = candleResult.error || tradeResult.error || holdingResult.error || topHoldersResult.error || watchedResult.error || economyResult.error || pulseResult.error || milestoneResult.error;
    if (otherError) throw otherError;
    const tradeRows = (tradeResult.data || []) as DbRow[];
    const topHolderRows = (topHoldersResult.data || []) as DbRow[];
    const relevantProfileIds = [...new Set([...tradeRows, ...topHolderRows].map((row) => String(row.profile_id || "")).filter(Boolean))];
    const earlyBuyersResult = relevantProfileIds.length
      ? await supabase.from("coin_early_buyers").select("profile_id,ordinal").eq("coin_id", id).in("profile_id", relevantProfileIds)
      : { data: [] as Array<{ profile_id: string; ordinal: number }>, error: null };
    if (earlyBuyersResult.error) throw earlyBuyersResult.error;
    const economy = economyResult.data && typeof economyResult.data === "object" && !Array.isArray(economyResult.data)
      ? economyResult.data as Record<string, unknown>
      : {};
    const holdingQuantity = Math.max(0, finiteNumber(holdingResult.data?.quantity));
    const earlyOrdinals = new Map((earlyBuyersResult.data || []).map((row) => [String(row.profile_id), Number(row.ordinal)]));
    return NextResponse.json({
      coin: mapCoin(coinResult.data),
      pulse: mapCoinPulse(pulseResult.data),
      candles: [...((candleResult.data || []) as DbRow[])].reverse().map((candle) => ({
        time: Math.floor(Date.parse(safeIsoDate(candle.bucket_start)) / 1000),
        open: finiteNumber(candle.open), high: finiteNumber(candle.high), low: finiteNumber(candle.low), close: finiteNumber(candle.close), volume: Math.max(0, finiteNumber(candle.volume)),
      })),
      trades: tradeRows.flatMap((trade) => {
        const trader = relationOne(trade.profiles, "Trade profile");
        const tradeId = typeof trade.id === "string" ? trade.id : "";
        const traderId = typeof trade.profile_id === "string" ? trade.profile_id : "";
        const createdAt = safeIsoDate(trade.created_at, "");
        const side = trade.side === "sell" ? "sell" : trade.side === "buy" ? "buy" : null;
        if (!tradeId || !traderId || !createdAt || !side) return [];
        return [{
          id: tradeId, side, quoteAmount: Math.max(0, finiteNumber(trade.quote_amount)), tokenAmount: Math.max(0, finiteNumber(trade.token_amount)), price: Math.max(0, finiteNumber(trade.price)), createdAt,
          traderId, traderName: profileName(trader), genesisOrdinal: earlyOrdinals.get(traderId) || null,
        }];
      }),
      events: ((milestoneResult.data || []) as DbRow[]).flatMap((event) => {
        const eventId = typeof event.id === "string" ? event.id : "";
        const kind = typeof event.kind === "string" ? event.kind : "";
        const createdAt = safeIsoDate(event.created_at, "");
        if (!eventId || !kind || !createdAt) return [];
        const actor = relationOne(event.profiles, "Milestone profile");
        return [{
          id: eventId,
          kind,
          actorId: typeof event.actor_profile_id === "string" ? event.actor_profile_id : null,
          actorName: profileName(actor),
          amount: event.amount == null ? null : Math.max(0, finiteNumber(event.amount)),
          metadata: event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata : {},
          createdAt,
        }];
      }),
      holding: { quantity: holdingQuantity, availableQuantity: Math.max(0, finiteNumber(economy.availableQuantity, holdingQuantity)), costBasis: Math.max(0, finiteNumber(holdingResult.data?.cost_basis)) },
      economy,
      balance: profileSnapshot.balance,
      availableBalance: profileSnapshot.availableBalance,
      reservedBalance: profileSnapshot.reservedBalance,
      watched: Boolean(watchedResult.data),
      topHolders: topHolderRows.flatMap((holder) => {
        const person = relationOne(holder.profiles, "Holder profile");
        const holderId = typeof holder.profile_id === "string" ? holder.profile_id : "";
        const quantity = Math.max(0, finiteNumber(holder.quantity));
        if (!holderId || quantity <= 0) return [];
        return [{ id: holderId, name: profileName(person), quantity, genesisOrdinal: earlyOrdinals.get(holderId) || null }];
      }),
    }, { headers: { "server-timing": `coin-detail;dur=${(performance.now() - startedAt).toFixed(1)}`, "cache-control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("coin detail", error);
    return apiFailure(error, "Не удалось загрузить мемкоин");
  }
}
export const GET = withApiErrors("app/api/coins/[id]/route.ts:GET", GETHandler);
