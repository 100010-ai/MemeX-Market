import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { recordAppError } from "@/lib/error-inbox";
import { getRuntimeConfig } from "@/lib/runtime-config";

function cleanText(value: unknown, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const baseName = cleanText(request.nextUrl.searchParams.get("baseName"));
  const supabase = getSupabaseAdmin();
  try {
    const outgoingBase = () => supabase.from("advanced_gift_offers_v056")
      .select("id,buyer_profile_id,base_name,scope_type,trait_value,amount,max_fills,filled_count,status,expires_at,created_at")
      .eq("buyer_profile_id", profile.id)
      .in("status", ["active", "filled", "failed"]);

    const marketBase = () => supabase.from("advanced_gift_offers_v056")
      .select("id,buyer_profile_id,base_name,scope_type,trait_value,amount,max_fills,filled_count,status,expires_at,created_at,profiles(username,first_name)")
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString());

    const outgoingPromise = baseName
      ? outgoingBase().eq("base_name", baseName).order("created_at", { ascending: false }).limit(100)
      : outgoingBase().order("created_at", { ascending: false }).limit(100);
    const marketPromise = baseName
      ? marketBase().eq("base_name", baseName).order("amount", { ascending: false }).limit(120)
      : marketBase().order("amount", { ascending: false }).limit(120);

    const [outgoing, market] = await Promise.all([outgoingPromise, marketPromise]);
    if (outgoing.error || market.error) throw outgoing.error || market.error;
    const map = (row: Record<string, unknown>) => {
      const relatedBuyer = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const buyer = relatedBuyer && typeof relatedBuyer === "object" ? relatedBuyer as Record<string, unknown> : null;
      return {
        id: String(row.id),
        buyerId: String(row.buyer_profile_id),
        buyerName: buyer ? (buyer.username ? `@${String(buyer.username)}` : buyer.first_name ? String(buyer.first_name) : null) : null,
        baseName: String(row.base_name),
        scopeType: row.scope_type as "collection" | "model" | "backdrop" | "symbol",
        traitValue: row.trait_value == null ? null : String(row.trait_value),
        amount: Number(row.amount),
        maxFills: Number(row.max_fills),
        filledCount: Number(row.filled_count),
        status: String(row.status),
        expiresAt: String(row.expires_at),
        createdAt: String(row.created_at),
      };
    };
    return NextResponse.json({
      outgoing: ((outgoing.data || []) as Record<string, unknown>[]).map(map),
      market: ((market.data || []) as Record<string, unknown>[]).map(map),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("advanced offers", error);
    await recordAppError("/api/market/offers", error, String(profile.id), { method: "GET" });
    return apiFailure(error, "Не удалось загрузить расширенные офферы");
  }
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "advanced-gift-offer", String(profile.id), 30, 60))) return NextResponse.json({ error: "Слишком много офферов. Подождите минуту." }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля Gifts временно отключена" }, { status: 503 });
  try {
    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    const baseName = cleanText(body.baseName);
    const scopeType = typeof body.scopeType === "string" && ["collection", "model", "backdrop", "symbol"].includes(body.scopeType) ? body.scopeType : null;
    const traitValue = cleanText(body.traitValue) || null;
    const amount = Number(body.amount);
    const maxFills = Number(body.maxFills ?? 1);
    const durationHours = Number(body.durationHours ?? 72);
    if (!baseName || !scopeType || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(maxFills) || maxFills < 1 || maxFills > 50 || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 720) {
      return NextResponse.json({ error: "Некорректные параметры оффера" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("create_advanced_gift_offer_v056", {
      p_buyer_id: profile.id,
      p_base_name: baseName,
      p_scope_type: scopeType,
      p_trait_value: scopeType === "collection" ? null : traitValue,
      p_amount: amount,
      p_max_fills: maxFills,
      p_duration_hours: durationHours,
    });
    if (error) return apiFailure(error, "Не удалось создать оффер", 400);
    return NextResponse.json({ offer: data }, { status: 201 });
  } catch (error) {
    console.error("create advanced offer", error);
    await recordAppError("/api/market/offers", error, String(profile.id), { method: "POST" });
    return apiFailure(error, "Не удалось создать оффер");
  }
}
export const GET = withApiErrors("app/api/market/offers/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/market/offers/route.ts:POST", POSTHandler);
