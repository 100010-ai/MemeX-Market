import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { STAR_PACKAGES } from "@/lib/economy";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sameOriginMutation, enforceRateLimit } from "@/lib/security";
import { telegramBotApi } from "@/lib/telegram-bot";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "stars-invoice", String(profile.id), 12, 300))) return NextResponse.json({ error: "Слишком много запросов оплаты" }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const stars = Number(body.stars);
  const pack = STAR_PACKAGES.find((item) => item.stars === stars);
  if (!pack) return NextResponse.json({ error: "Неизвестный пакет" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const purchaseId = crypto.randomUUID();
  const payload = `mxm:${purchaseId}`;
  const insert = await supabase.from("star_purchases").insert({
    id: purchaseId,
    profile_id: profile.id,
    stars: pack.stars,
    ton_reward: pack.virtualTon,
    invoice_payload: payload,
  });
  if (insert.error) {
    const missing = /star_purchases|schema cache|relation .* does not exist/i.test(insert.error.message || "");
    return NextResponse.json({ error: missing ? "Примените миграцию 021_v046_stars_referrals_market_polish.sql" : "Не удалось создать покупку" }, { status: 500 });
  }

  try {
    const invoiceUrl = await telegramBotApi<string>("createInvoiceLink", {
      title: `${pack.virtualTon.toLocaleString("ru-RU")} виртуальных TON MXM`,
      description: "Внутренняя игровая валюта MXM. Не является настоящим TON и не выводится в блокчейн.",
      payload,
      currency: "XTR",
      prices: [{ label: `${pack.virtualTon.toLocaleString("ru-RU")} виртуальных TON`, amount: pack.stars }],
    });
    return NextResponse.json({ purchaseId, invoiceUrl, stars: pack.stars, virtualTon: pack.virtualTon }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await supabase.from("star_purchases").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", purchaseId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось открыть оплату Stars" }, { status: 502 });
  }
}
