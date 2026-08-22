import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type OwnedGift = { base_name: string; model_rarity_per_mille: number | string; backdrop_rarity_per_mille: number | string; symbol_rarity_per_mille: number | string };

function rarityPoints(row: OwnedGift) {
  const rarity = Math.min(Number(row.model_rarity_per_mille), Number(row.backdrop_rarity_per_mille), Number(row.symbol_rarity_per_mille));
  if (rarity <= 10) return 5;
  if (rarity <= 30) return 3;
  if (rarity <= 100) return 2;
  return 1;
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const ownedResult = await supabase
    .from("gift_market_overview")
    .select("base_name,model_rarity_per_mille,backdrop_rarity_per_mille,symbol_rarity_per_mille")
    .eq("owner_profile_id", profile.id)
    .eq("is_burned", false)
    .limit(5_000);
  if (ownedResult.error) return apiFailure(ownedResult.error, "Не удалось загрузить коллекцию");
  const owned = (ownedResult.data || []) as OwnedGift[];
  const names = [...new Set(owned.map((row) => String(row.base_name)))];
  const [overviewResult, claimsResult] = await Promise.all([
    names.length
      ? supabase.from("gift_collection_overview").select("base_name,item_count,holder_count,floor_price").in("base_name", names)
      : Promise.resolve({ data: [] as Array<{ base_name: string; item_count: number; holder_count: number; floor_price: number | null }>, error: null }),
    supabase.from("collection_bonus_claims").select("base_name,claimed_at").eq("profile_id", profile.id),
  ]);
  if (overviewResult.error) return apiFailure(overviewResult.error, "Не удалось загрузить серии Gifts");
  if (claimsResult.error) return apiFailure(claimsResult.error, "Не удалось загрузить бонусы коллекций");
  const claimed = new Set((claimsResult.data || []).map((row) => String(row.base_name)));
  const overviewRows = (overviewResult.data || []) as Array<{ base_name: string; item_count: number; holder_count: number; floor_price: number | null }>;
  const overview = new Map<string, { base_name: string; item_count: number; holder_count: number; floor_price: number | null }>(overviewRows.map((row) => [String(row.base_name), row]));
  const groups = new Map<string, OwnedGift[]>();
  for (const row of owned) groups.set(row.base_name, [...(groups.get(row.base_name) || []), row]);
  const collections = [...groups.entries()].map(([baseName, rows]) => {
    const market = overview.get(baseName);
    const target = Math.min(5, Math.max(1, Number(market?.item_count || 5)));
    const points = rows.reduce((sum, row) => sum + rarityPoints(row), 0);
    return { baseName, owned: rows.length, target, complete: rows.length >= target, claimed: claimed.has(baseName), rarityPoints: points, holders: Number(market?.holder_count || 0), floorPrice: market?.floor_price == null ? null : Number(market.floor_price) };
  }).sort((a, b) => Number(b.complete) - Number(a.complete) || b.rarityPoints - a.rarityPoints || b.owned - a.owned);
  const totalPoints = collections.reduce((sum, item) => sum + item.rarityPoints, 0);
  const level = Math.max(1, Math.floor(Math.sqrt(totalPoints / 5)) + 1);
  const levelStart = 5 * Math.pow(level - 1, 2);
  const nextLevel = 5 * Math.pow(level, 2);
  return NextResponse.json({ level, totalPoints, nextLevel, progress: Math.max(0, Math.min(1, (totalPoints - levelStart) / Math.max(1, nextLevel - levelStart))), giftCount: owned.length, completed: collections.filter((item) => item.complete).length, collections, claimsReady: true }, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "collection-bonus", String(profile.id), 12, 300))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const baseName = typeof body.baseName === "string" ? body.baseName.trim() : "";
  if (baseName.length < 2 || baseName.length > 80) return NextResponse.json({ error: "Некорректная коллекция" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("claim_collection_bonus_v200", { p_profile_id: profile.id, p_base_name: baseName });
  if (error) {
    console.error("collection bonus", error);
    const incomplete = /not complete|required|unique/i.test(error.message || "");
    const claimed = /already|duplicate/i.test(error.message || "");
    if (!incomplete && !claimed) return apiFailure(error, "Не удалось получить бонус коллекции", 400);
    return NextResponse.json({ error: incomplete ? "Серия ещё не собрана" : "Бонус этой серии уже получен" }, { status: 409 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
export const GET = withApiErrors("app/api/collections/progress/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/collections/progress/route.ts:POST", POSTHandler);
