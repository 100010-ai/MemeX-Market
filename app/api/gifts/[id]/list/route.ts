import { apiFailure, publicBusinessError, readJsonObject, withApiErrors } from "@/lib/api-route";
import { after, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { evaluatePlayerMarketHandoff } from "@/lib/npc-market";
import { parseEconomyAmount } from "@/lib/economy";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-list", String(profile.id), 35, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID подарка" }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const hasPrice = body.price !== null && body.price !== "" && body.price !== undefined;
  const price = hasPrice ? parseEconomyAmount(body.price) : null;
  const hasDuration = body.durationDays !== null && body.durationDays !== "" && body.durationDays !== undefined;
  const durationDays = hasDuration ? parseEconomyAmount(body.durationDays) : null;
  if (hasPrice && (price == null || price <= 0 || price > 1_000_000_000)) return NextResponse.json({ error: "Некорректная цена лота" }, { status: 400 });
  if (hasDuration && (durationDays == null || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30)) return NextResponse.json({ error: "Срок продажи должен быть от 1 до 30 дней" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("list_virtual_gift_v2", { p_profile_id: profile.id, p_virtual_gift_id: id, p_price: price, p_duration_days: durationDays });
  if (error) return NextResponse.json({ error: publicBusinessError(error, "Не удалось выставить подарок") }, { status: 400 });
  after(async () => {
    try {
      await evaluatePlayerMarketHandoff(false);
    } catch (cause) {
      console.error("gift market handoff after listing", cause);
    }
  });
  return NextResponse.json({ listing: data });
}
export const POST = withApiErrors("app/api/gifts/[id]/list/route.ts:POST", POSTHandler);
