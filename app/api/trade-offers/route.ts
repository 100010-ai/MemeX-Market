import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { finiteNumber, nonEmptyId, nullableText, safeIsoDate, text } from "@/lib/safe-data";

type Row = Record<string, unknown>;

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const requestedGiftId = request.nextUrl.searchParams.get("requestedGiftId") || "";
  try {
    await supabase.from("gift_trade_offers_v200").update({ status: "expired", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("status", "active").lte("expires_at", new Date().toISOString());
    const [offersResult, ownGiftsResult] = await Promise.all([
      supabase.from("gift_trade_offers_v200").select("id,sender_profile_id,recipient_profile_id,offered_gift_id,requested_gift_id,topup_amount,status,note,expires_at,resolved_at,created_at").or(`sender_profile_id.eq.${profile.id},recipient_profile_id.eq.${profile.id}`).order("created_at", { ascending: false }).limit(100),
      supabase.from("gift_market_overview").select(giftMarketSelect).eq("owner_profile_id", profile.id).eq("is_burned", false).order("estimated_value", { ascending: false, nullsFirst: false }).limit(100),
    ]);
    if (offersResult.error || ownGiftsResult.error) throw offersResult.error || ownGiftsResult.error;
    const rows = (offersResult.data || []) as Row[];
    const giftIds = new Set<string>();
    const profileIds = new Set<string>();
    for (const row of rows) {
      const offered = nonEmptyId(row.offered_gift_id); const requested = nonEmptyId(row.requested_gift_id);
      if (offered) giftIds.add(offered); if (requested) giftIds.add(requested);
      const sender = nonEmptyId(row.sender_profile_id); const recipient = nonEmptyId(row.recipient_profile_id);
      if (sender) profileIds.add(sender); if (recipient) profileIds.add(recipient);
    }
    if (validUuidLike(requestedGiftId)) giftIds.add(requestedGiftId);
    const [giftsResult, peopleResult] = await Promise.all([
      giftIds.size ? supabase.from("gift_market_overview").select(giftMarketSelect).in("virtual_gift_id", [...giftIds]) : Promise.resolve({ data: [], error: null }),
      profileIds.size ? supabase.from("profiles").select("id,username,first_name,photo_url").in("id", [...profileIds]) : Promise.resolve({ data: [], error: null }),
    ]);
    if (giftsResult.error || peopleResult.error) throw giftsResult.error || peopleResult.error;
    const gifts = new Map((giftsResult.data || []).map((row) => { const gift = mapGift(row); return [gift.virtualGiftId, gift] as const; }));
    const people = new Map((peopleResult.data || []).map((row) => [String(row.id), { name: row.username ? `@${row.username}` : row.first_name || "Пользователь", photoUrl: nullableText(row.photo_url, 2000) }]));
    const offers = rows.flatMap((row) => {
      const id = nonEmptyId(row.id); const senderId = nonEmptyId(row.sender_profile_id); const recipientId = nonEmptyId(row.recipient_profile_id); const offeredId = nonEmptyId(row.offered_gift_id); const requestedId = nonEmptyId(row.requested_gift_id);
      if (!id || !senderId || !recipientId || !offeredId || !requestedId) return [];
      const offeredGift = gifts.get(offeredId); const requestedGift = gifts.get(requestedId); if (!offeredGift || !requestedGift) return [];
      return [{ id, direction: senderId === String(profile.id) ? "outgoing" : "incoming", senderId, senderName: people.get(senderId)?.name || "Пользователь", recipientId, recipientName: people.get(recipientId)?.name || "Пользователь", offeredGift, requestedGift, topupAmount: Math.max(0, finiteNumber(row.topup_amount)), status: text(row.status, "active", 24), note: nullableText(row.note, 240), expiresAt: safeIsoDate(row.expires_at), createdAt: safeIsoDate(row.created_at) }];
    });
    return NextResponse.json({
      incoming: offers.filter((offer) => offer.direction === "incoming"), outgoing: offers.filter((offer) => offer.direction === "outgoing"),
      myGifts: (ownGiftsResult.data || []).map(mapGift).filter((gift) => Boolean(gift.virtualGiftId)),
      requestedGift: validUuidLike(requestedGiftId) ? gifts.get(requestedGiftId) || null : null,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error, "Не удалось загрузить Trade Center"); }
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "trade-offer-create", String(profile.id), 20, 60))) return NextResponse.json({ error: "Слишком много предложений" }, { status: 429 });
  const body = await readJsonObject(request); if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const requestedGiftId = typeof body.requestedGiftId === "string" ? body.requestedGiftId : "";
  const offeredGiftId = typeof body.offeredGiftId === "string" ? body.offeredGiftId : "";
  if (!validUuidLike(requestedGiftId) || !validUuidLike(offeredGiftId)) return NextResponse.json({ error: "Некорректный подарок" }, { status: 400 });
  const topupAmount = Number(body.topupAmount || 0); const durationHours = Number(body.durationHours || 72); const note = typeof body.note === "string" ? body.note.trim().slice(0, 240) : null;
  if (!Number.isFinite(topupAmount) || topupAmount < 0 || topupAmount > 1_000_000_000) return NextResponse.json({ error: "Некорректная доплата" }, { status: 400 });
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 336) return NextResponse.json({ error: "Некорректный срок" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("create_gift_trade_offer_v200", { p_sender_id: profile.id, p_requested_gift_id: requestedGiftId, p_offered_gift_id: offeredGiftId, p_topup_amount: topupAmount, p_duration_hours: durationHours, p_note: note });
  if (error) return apiFailure(error, "Не удалось создать обмен", 400);
  return NextResponse.json({ offer: data }, { status: 201, headers: { "cache-control": "no-store" } });
}
export const GET = withApiErrors("app/api/trade-offers/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/trade-offers/route.ts:POST", POSTHandler);
