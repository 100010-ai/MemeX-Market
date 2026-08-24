import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { recordAppError } from "@/lib/error-inbox";
import { safeSecretEquals } from "@/lib/security";

function authorized(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return safeSecretEquals(bearer, secret) || safeSecretEquals(request.headers.get("x-mxm-cron-secret") || "", secret);
}

async function processOrders(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("process_coin_conditional_orders_v056", { p_limit: 100 });
  if (error) {
    console.error("coin order processor", error);
    await recordAppError("/api/system/coin-orders", error, null);
    return apiFailure(error, "Не удалось обработать условные заявки");
  }
  return NextResponse.json({ ok: true, result: data }, { headers: { "cache-control": "no-store" } });
}

async function GETHandler(request: Request) { return processOrders(request); }
async function POSTHandler(request: Request) { return processOrders(request); }
export const GET = withApiErrors("app/api/system/coin-orders/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/system/coin-orders/route.ts:POST", POSTHandler);
