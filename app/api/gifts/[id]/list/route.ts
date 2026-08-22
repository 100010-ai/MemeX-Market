import { readJsonObject, withApiErrors } from "@/lib/api-route";
import { after, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { evaluatePlayerMarketHandoff } from "@/lib/npc-market";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-list", String(profile.id), 35, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const { id } = await params;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const price = body.price === null || body.price === "" || body.price === undefined ? null : Number(body.price);
  const durationDays = body.durationDays == null ? null : Number(body.durationDays);
  if (price !== null && (!Number.isFinite(price) || price <= 0)) return NextResponse.json({ error: "Некорректная цена лота" }, { status: 400 });
  if (durationDays !== null && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30)) return NextResponse.json({ error: "Срок продажи должен быть от 1 до 30 дней" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("list_virtual_gift_v2", { p_profile_id: profile.id, p_virtual_gift_id: id, p_price: price, p_duration_days: durationDays });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  after(() => evaluatePlayerMarketHandoff(false).catch((cause) => console.error("gift market handoff after listing", cause)));
  return NextResponse.json({ listing: data });
}
export const POST = withApiErrors("app/api/gifts/[id]/list/route.ts:POST", POSTHandler);
