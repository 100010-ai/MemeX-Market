import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { telegramBotApi } from "@/lib/telegram-bot";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

const eligibilityMessages: Record<string, string> = {
  product_unavailable: "Товар временно недоступен",
  profile_missing: "Профиль не найден",
  case_sold_out: "Этот кейс распродан",
  season_pass_owned: "Premium Track текущего сезона уже открыт",
  profile_item_owned: "Этот предмет профиля уже получен",
  energy_full: "Energy уже заполнена",
  invalid_creator_coin: "Выберите свой активный мемкоин",
  memecoins_disabled: "Рынок мемкоинов временно отключён",
  boost_capacity_full: "Все слоты Coin Boost сейчас заняты",
  stars_disabled: "Покупки за Stars временно отключены",
};

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "stars-invoice", String(profile.id), 12, 300))) return NextResponse.json({ error: "Слишком много запросов оплаты" }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.stars) return NextResponse.json({ error: "Покупки за Stars временно отключены" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();
  const cleanupResult = await supabase
    .rpc("release_expired_star_authorizations_v200", { p_limit: 25 })
    .abortSignal(AbortSignal.timeout(1_500));
  if (cleanupResult.error && !["42883", "PGRST202"].includes(String(cleanupResult.error.code || ""))) {
    console.error("star reservation cleanup", cleanupResult.error);
  }
  const sku = typeof body.sku === "string" ? body.sku.trim().toLowerCase() : "";
  let stars = 0;
  const virtualTon = 0;
  let title = "MXM Store";
  let description = "Игровая покупка внутри виртуальной экономики MXM. Не является настоящим TON и не выводится.";
  let rewardLabel = "Покупка MXM";
  let productSku: string | null = null;
  let productContext: Record<string, string> = {};

  if (sku) {
    if (!/^[a-z0-9_]{3,48}$/.test(sku)) return NextResponse.json({ error: "Некорректный товар" }, { status: 400 });
    if (body.termsAccepted !== true) return NextResponse.json({ error: "Подтвердите условия цифровой покупки" }, { status: 400 });
    productContext = { termsAcceptedAt: new Date().toISOString() };
    const productResult = await supabase
      .from("store_products")
      .select("sku,title,description,stars_price,reward_label,metadata")
      .eq("sku", sku)
      .eq("active", true)
      .maybeSingle();
    if (productResult.error) {
      const missing = /store_products|schema cache|relation .* does not exist/i.test(productResult.error.message || "");
      return NextResponse.json({ error: missing ? "Примените миграцию экономики Market 2.0" : "Не удалось загрузить товар" }, { status: missing ? 503 : 500 });
    }
    if (!productResult.data) return NextResponse.json({ error: "Товар недоступен" }, { status: 404 });
    const product = productResult.data as Record<string, unknown>;
    const metadata = product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
      ? product.metadata as Record<string, unknown>
      : {};
    stars = Number(product.stars_price);
    if (!Number.isInteger(stars) || stars < 5 || stars > 100_000) return NextResponse.json({ error: "Некорректная цена товара" }, { status: 500 });
    productSku = String(product.sku);
    title = String(product.title || "MXM Store").slice(0, 32);
    description = `${String(product.description || "Игровая покупка MXM")} Только внутри MXM; без вывода и денежной стоимости.`.slice(0, 255);
    rewardLabel = String(product.reward_label || product.title || "Покупка MXM").slice(0, 32);
    if (metadata.requiresCoin === true) {
      if (metadata.creatorTool === "boost" && !runtimeConfig.featureFlags.memecoins) {
        return NextResponse.json({ error: eligibilityMessages.memecoins_disabled, reason: "memecoins_disabled" }, { status: 503 });
      }
      const coinId = body.context && typeof body.context === "object" ? String(body.context.coinId || "") : "";
      if (!validUuidLike(coinId)) return NextResponse.json({ error: "Выберите мемкоин для продвижения" }, { status: 400 });
      const coin = await supabase.from("coins").select("id").eq("id", coinId).eq("creator_profile_id", profile.id).eq("status", "active").eq("hidden_from_market", false).maybeSingle();
      if (coin.error) return NextResponse.json({ error: "Не удалось проверить мемкоин" }, { status: 500 });
      if (!coin.data) return NextResponse.json({ error: "Можно продвигать только свой активный мемкоин" }, { status: 403 });
      productContext.coinId = coinId;
    }
    const eligibility = await supabase.rpc("store_purchase_eligibility_v200", {
      p_profile_id: profile.id,
      p_product_sku: productSku,
      p_product_context: productContext,
    });
    if (eligibility.error) {
      const missing = eligibility.error.code === "42883" || /store_purchase_eligibility_v200|schema cache|could not find the function/i.test(eligibility.error.message || "");
      return NextResponse.json({ error: missing ? "Примените миграцию экономики Market 2.0" : "Не удалось проверить доступность товара" }, { status: missing ? 503 : 500 });
    }
    const eligibilityData = eligibility.data && typeof eligibility.data === "object" && !Array.isArray(eligibility.data)
      ? eligibility.data as Record<string, unknown>
      : {};
    if (eligibilityData.eligible !== true) {
      const reason = String(eligibilityData.reason || "product_unavailable");
      return NextResponse.json({ error: eligibilityMessages[reason] || "Покупка сейчас недоступна", reason }, { status: 409 });
    }
    if (Number(eligibilityData.stars) !== stars) return NextResponse.json({ error: "Цена товара изменилась. Обновите магазин." }, { status: 409 });
  } else return NextResponse.json({ error: "Не выбран товар MXM Store" }, { status: 400 });

  if (!Number.isInteger(stars) || stars < 5 || stars > 100_000) return NextResponse.json({ error: "Некорректная цена Stars" }, { status: 400 });

  const purchaseId = crypto.randomUUID();
  const payload = `mxm:${purchaseId}`;
  const purchaseRow: Record<string, unknown> = {
    id: purchaseId,
    profile_id: profile.id,
    stars,
    ton_reward: virtualTon,
    invoice_payload: payload,
  };
  if (productSku) {
    purchaseRow.product_sku = productSku;
    purchaseRow.product_context = productContext;
  }
  const insert = await supabase.from("star_purchases").insert(purchaseRow);
  if (insert.error) {
    const missing = /star_purchases|schema cache|relation .* does not exist/i.test(insert.error.message || "");
    return NextResponse.json({ error: missing ? "Примените миграцию 021_v046_stars_referrals_market_polish.sql" : "Не удалось создать покупку" }, { status: 500 });
  }

  try {
    const invoiceUrl = await telegramBotApi<string>("createInvoiceLink", {
      title,
      description,
      payload,
      currency: "XTR",
      prices: [{ label: rewardLabel, amount: stars }],
    });
    return NextResponse.json({ purchaseId, invoiceUrl, stars, virtualTon, productSku, rewardLabel }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await supabase.from("star_purchases").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", purchaseId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось открыть оплату Stars" }, { status: 502 });
  }
}
export const POST = withApiErrors("app/api/stars/invoice/route.ts:POST", POSTHandler);
