import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { recordAppError } from "@/lib/error-inbox";
import { safeSecretEquals } from "@/lib/security";

async function processOrders(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeSecretEquals(supplied, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("process_coin_conditional_orders_v056", { p_limit: 100 });
  if (error) {
    console.error("coin order processor", error);
    await recordAppError("/api/system/coin-orders", error, null);
    return NextResponse.json({ error: "Order processor failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: data }, { headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) { return processOrders(request); }
export async function POST(request: Request) { return processOrders(request); }
