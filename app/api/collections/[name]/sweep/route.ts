import { apiFailure, publicBusinessError, readJsonObject, withApiErrors } from "@/lib/api-route";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { looseRowsQuery } from "@/lib/supabase/loose-query";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { safeDecodeURIComponent } from "@/lib/safe-data";
import { getGiftMarketLiquidityState } from "@/lib/npc-market";

const allowedCounts = new Set([2, 3, 5, 10]);

async function POSTHandler(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "collection-sweep", String(profile.id), 12, 60))) return NextResponse.json({ error: "Слишком много операций. Подождите немного." }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });

  const { name } = await params;
  const baseName = safeDecodeURIComponent(name);
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const count = Number(body.count);
  if (!baseName) return NextResponse.json({ error: "Некорректное имя коллекции" }, { status: 400 });
  if (!Number.isInteger(count) || !allowedCounts.has(count)) return NextResponse.json({ error: "Можно купить 2, 3, 5 или 10 самых дешёвых подарков" }, { status: 400 });

  const requestKey = request.headers.get("x-idempotency-key")?.trim() || `sweep-${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(requestKey)) return NextResponse.json({ error: "Некорректный ключ операции" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const liquidity = await getGiftMarketLiquidityState();
  let systemOwnerIds: string[] = [];
  if (liquidity.playerOnly) {
    const systemProfiles = await supabase.from("profiles").select("id").eq("is_system", true).limit(100);
    if (systemProfiles.error) return apiFailure(systemProfiles.error, "Не удалось проверить продавцов коллекции");
    systemOwnerIds = (systemProfiles.data || []).map((row) => String(row.id)).filter(Boolean);
  }
  const nowIso = new Date().toISOString();
  type SweepCandidate = { virtual_gift_id: unknown; listing_price: unknown; owner_profile_id: unknown };
  const candidateQuery = () => looseRowsQuery<SweepCandidate>(supabase.from("gift_market_overview"))
    .select("virtual_gift_id,listing_price,owner_profile_id")
    .eq("base_name", baseName)
    .eq("is_burned", false)
    .eq("status", "listed")
    .not("listing_price", "is", null)
    .neq("owner_profile_id", profile.id)
    .or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`);

  // The builder is widened before composition so Supabase's recursive type-level
  // filter/select parser cannot hit TS2589 during `next build`. Runtime calls
  // still execute on the real PostgREST builder.
  const candidates = systemOwnerIds.length
    ? await candidateQuery()
      .not("owner_profile_id", "in", `(${systemOwnerIds.join(",")})`)
      .order("listing_price", { ascending: true })
      .order("virtual_gift_id", { ascending: true })
      .limit(count)
    : await candidateQuery()
      .order("listing_price", { ascending: true })
      .order("virtual_gift_id", { ascending: true })
      .limit(count);

  if (candidates.error) return apiFailure(candidates.error, "Не удалось выполнить запрос");
  const rows = candidates.data || [];
  if (rows.length < count) return NextResponse.json({ error: `В коллекции сейчас доступно только ${rows.length} подходящих лотов` }, { status: 409 });

  const ids = rows.map((row) => String(row.virtual_gift_id));
  const quotedTotal = rows.reduce((sum, row) => sum + Number(row.listing_price || 0), 0);
  const purchase = await supabase.rpc("buy_virtual_gift_cart_v2", {
    p_buyer_id: profile.id,
    p_virtual_gift_ids: ids,
    p_request_key: requestKey,
  });
  if (purchase.error) return NextResponse.json({ error: publicBusinessError(purchase.error, "Не удалось выполнить массовую покупку") }, { status: 409 });

  return NextResponse.json({
    sweep: purchase.data,
    selectedIds: ids,
    quotedTotal,
  }, { headers: { "cache-control": "no-store" } });
}
export const POST = withApiErrors("app/api/collections/[name]/sweep/route.ts:POST", POSTHandler);
