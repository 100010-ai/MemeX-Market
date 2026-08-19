import { NextResponse } from "next/server";
import { safeSecretEquals } from "@/lib/rewarded-ads";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";

export const runtime = "nodejs";

type TelegramUpdate = {
  pre_checkout_query?: { id: string; currency: string; total_amount: number; invoice_payload: string };
  message?: { successful_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string; provider_payment_charge_id?: string } };
};

export async function POST(request: Request) {
  const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  const provided = String(request.headers.get("x-telegram-bot-api-secret-token") || "").trim();
  if (process.env.NODE_ENV === "production" && (!expected || expected.length < 16)) return NextResponse.json({ error: "Webhook secret is not configured" }, { status: 503 });
  if (expected && !safeSecretEquals(provided, expected)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const update = await request.json().catch(() => ({})) as TelegramUpdate;
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query;
    let valid = query.currency === "XTR" && /^mxm:[0-9a-f-]{36}$/i.test(query.invoice_payload) && Number.isInteger(query.total_amount) && query.total_amount > 0;
    if (valid) {
      const purchaseId = query.invoice_payload.slice(4);
      const supabase = getSupabaseAdmin();
      const purchase = await supabase.from("star_purchases").select("stars,status").eq("id", purchaseId).eq("invoice_payload", query.invoice_payload).maybeSingle();
      valid = !purchase.error && purchase.data?.status === "pending" && Number(purchase.data.stars) === query.total_amount;
    }
    await telegramBotApi("answerPreCheckoutQuery", valid
      ? { pre_checkout_query_id: query.id, ok: true }
      : { pre_checkout_query_id: query.id, ok: false, error_message: "Платёж MXM не прошёл проверку" });
    return NextResponse.json({ ok: true });
  }

  const payment = update.message?.successful_payment;
  if (payment?.currency === "XTR" && /^mxm:[0-9a-f-]{36}$/i.test(payment.invoice_payload)) {
    const purchaseId = payment.invoice_payload.slice(4);
    const supabase = getSupabaseAdmin();
    const result = await supabase.rpc("finalize_star_purchase_v046", {
      p_purchase_id: purchaseId,
      p_charge_id: payment.telegram_payment_charge_id,
      p_stars: payment.total_amount,
    });
    if (result.error) {
      console.error("star purchase finalize", result.error);
      return NextResponse.json({ error: "Payment finalize failed" }, { status: 500 });
    }
    if (payment.provider_payment_charge_id) {
      await supabase.from("star_purchases").update({ provider_payment_charge_id: payment.provider_payment_charge_id, updated_at: new Date().toISOString() }).eq("id", purchaseId);
    }
  }
  return NextResponse.json({ ok: true });
}
