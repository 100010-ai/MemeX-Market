import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { safeSecretEquals } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";
import { getHumanSupportUsername } from "@/lib/support";

export const runtime = "nodejs";

type TelegramUpdate = {
  pre_checkout_query?: { id: string; from: { id: number }; currency: string; total_amount: number; invoice_payload: string };
  message?: {
    chat?: { id: number };
    from?: { id: number };
    text?: string;
    successful_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string; provider_payment_charge_id?: string };
    refunded_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string; provider_payment_charge_id?: string };
  };
};

async function POSTHandler(request: Request) {
  const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  const provided = String(request.headers.get("x-telegram-bot-api-secret-token") || "").trim();
  if (process.env.NODE_ENV === "production" && (!expected || expected.length < 16)) return NextResponse.json({ error: "Webhook secret is not configured" }, { status: 503 });
  if (expected && !safeSecretEquals(provided, expected)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const update = await request.json().catch(() => ({})) as TelegramUpdate;
  if (update.pre_checkout_query) {
    const checkoutStartedAt = Date.now();
    const query = update.pre_checkout_query;
    let valid = query.currency === "XTR" && /^mxm:[0-9a-f-]{36}$/i.test(query.invoice_payload) && Number.isInteger(query.total_amount) && query.total_amount >= 5;
    if (valid) {
      const purchaseId = query.invoice_payload.slice(4);
      const supabase = getSupabaseAdmin();
      const authorization = await supabase.rpc("authorize_star_precheckout_v200", {
        p_purchase_id: purchaseId,
        p_payload: query.invoice_payload,
        p_query_id: query.id,
        p_payer_telegram_id: query.from.id,
        p_stars: query.total_amount,
      }).abortSignal(AbortSignal.timeout(4_500));
      const result = authorization.data && typeof authorization.data === "object" && !Array.isArray(authorization.data)
        ? authorization.data as Record<string, unknown>
        : {};
      valid = !authorization.error && result.ok === true;
      if (authorization.error) console.error("star pre-checkout authorization", authorization.error);
    }
    const answerBudgetMs = Math.max(1_000, 8_000 - (Date.now() - checkoutStartedAt));
    await telegramBotApi("answerPreCheckoutQuery", valid
      ? { pre_checkout_query_id: query.id, ok: true }
      : { pre_checkout_query_id: query.id, ok: false, error_message: "Платёж MXM не прошёл проверку" }, answerBudgetMs);
    return NextResponse.json({ ok: true });
  }

  const refunded = update.message?.refunded_payment;
  if (refunded?.currency === "XTR" && /^mxm:[0-9a-f-]{36}$/i.test(refunded.invoice_payload)) {
    const purchaseId = refunded.invoice_payload.slice(4);
    const supabase = getSupabaseAdmin();
    const purchase = await supabase.from("star_purchases")
      .select("id,status,stars,telegram_payment_charge_id,payer_telegram_id,refunded_at")
      .eq("id", purchaseId)
      .eq("invoice_payload", refunded.invoice_payload)
      .maybeSingle();
    const purchaseData = purchase.data;
    const matches = !purchase.error && purchaseData
      && Number(purchaseData.stars) === refunded.total_amount
      && String(purchaseData.telegram_payment_charge_id || "") === refunded.telegram_payment_charge_id
      && String(purchaseData.payer_telegram_id || "") === String(update.message?.from?.id || "");
    if (!matches || !purchaseData) {
      console.error("refunded Stars payment mismatch", purchase.error || { purchaseId });
      return NextResponse.json({ error: "Refund verification failed" }, { status: 409 });
    }
    const transition = await supabase.rpc("mark_star_purchase_refunded_v200", {
      p_purchase_id: purchaseId,
      p_charge_id: refunded.telegram_payment_charge_id,
      p_reason: "Telegram refunded payment update",
      p_metadata: { source: "telegram_refunded_payment", fulfillmentReversal: "manual_review_required" },
    });
    const transitionData = transition.data && typeof transition.data === "object" && !Array.isArray(transition.data)
      ? transition.data as Record<string, unknown>
      : {};
    if (transition.error || transitionData.status !== "refunded") {
      console.error("refunded Stars reconciliation", transition.error || { purchaseId, status: transitionData.status });
      return NextResponse.json({ error: "Refund reconciliation failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const payment = update.message?.successful_payment;
  if (payment?.currency === "XTR" && /^mxm:[0-9a-f-]{36}$/i.test(payment.invoice_payload)) {
    const purchaseId = payment.invoice_payload.slice(4);
    const supabase = getSupabaseAdmin();
    const purchase = await supabase.from("star_purchases").select("product_sku,ton_reward,payer_telegram_id").eq("id", purchaseId).maybeSingle();
    if (purchase.error || !purchase.data || String(purchase.data.payer_telegram_id || "") !== String(update.message?.from?.id || "")) {
      console.error("star purchase payer mismatch", purchase.error || { purchaseId });
      return NextResponse.json({ error: "Payment payer verification failed" }, { status: 403 });
    }
    const result = await supabase.rpc("finalize_star_purchase_v200", {
      p_purchase_id: purchaseId,
      p_charge_id: payment.telegram_payment_charge_id,
      p_stars: payment.total_amount,
      p_payer_telegram_id: update.message?.from?.id,
    });
    if (result.error) {
      console.error("star purchase finalize", result.error);
      return NextResponse.json({ error: "Payment finalize failed" }, { status: 500 });
    }
    const finalized = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as Record<string, unknown>
      : {};
    if (finalized.status !== "paid") {
      console.error("star purchase was not finalized", { purchaseId, status: finalized.status });
      return NextResponse.json({ error: "Payment was not finalized" }, { status: 409 });
    }
    if (payment.provider_payment_charge_id) {
      await supabase.from("star_purchases").update({ provider_payment_charge_id: payment.provider_payment_charge_id, updated_at: new Date().toISOString() }).eq("id", purchaseId);
    }
  }

  const command = String(update.message?.text || "").trim().split(/\s+/)[0]?.split("@")[0]?.toLowerCase();
  const chatId = update.message?.chat?.id;
  if (chatId && (command === "/terms" || command === "/paysupport")) {
    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const supportName = getHumanSupportUsername();
    const text = command === "/terms"
      ? `Условия MXM: все активы, TON и MXM Coins внутри приложения виртуальные, не выводятся и не обещают доход. Покупки за Stars дают только описанные цифровые предметы и возможности.${appUrl ? `\n\n${appUrl}/terms` : ""}`
      : `Поддержка покупок MXM${supportName ? `: @${supportName}` : " доступна на странице приложения"}. При обращении укажите дату, товар и Telegram payment charge ID из чека.${appUrl ? `\n\n${appUrl}/paysupport` : ""}`;
    try {
      await telegramBotApi("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
    } catch (error) {
      console.error("payment support command", error);
    }
  }
  return NextResponse.json({ ok: true });
}
export const POST = withApiErrors("app/api/telegram/webhook/route.ts:POST", POSTHandler);
