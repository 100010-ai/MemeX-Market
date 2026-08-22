import { readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sameOriginMutation, validUuidLike } from "@/lib/security";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID ордера" }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  if (body.action !== "cancel") return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("cancel_coin_conditional_order_v056", { p_profile_id: profile.id, p_order_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ result: data });
}
export const POST = withApiErrors("app/api/coin-orders/[id]/route.ts:POST", POSTHandler);
