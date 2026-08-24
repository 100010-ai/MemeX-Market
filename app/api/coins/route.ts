import { apiFailure, publicBusinessError, readFormData, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { removeCoinImage, uploadCoinImage } from "@/lib/coin-media";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { finiteNumber, safeIsoDate } from "@/lib/safe-data";
import { parseEconomyAmount } from "@/lib/economy";

export const runtime = "nodejs";

function validate(name: string, symbol: string, description: string) {
  if (name.length < 2 || name.length > 32) return "Название должно содержать 2–32 символа";
  if (!/^[A-Z0-9]{2,8}$/.test(symbol)) return "Тикер должен содержать 2–8 латинских букв или цифр";
  if (description.length > 180) return "Описание слишком длинное";
  return null;
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const [coinsResult, settingsResult, monetizationResult] = await Promise.all([
    supabase.from("coins").select("id,status,created_at").eq("creator_profile_id", profile.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("economy_settings").select("schema_version,coin_launch_fee,coin_launch_cooldown_hours,coin_max_active,coin_initial_buy_min,coin_initial_buy_max,coin_start_price_min,coin_start_price_max,coin_floor_max_bps,coin_launch_energy_cost,coin_total_fee_bps").eq("singleton", true).maybeSingle(),
    supabase.rpc("monetization_snapshot_v200", { p_profile_id: profile.id }),
  ]);
  const firstError = coinsResult.error || settingsResult.error || monetizationResult.error;
  if (firstError) return apiFailure(firstError, "Не удалось загрузить правила запуска мемкоина");
  if (!settingsResult.data || Number(settingsResult.data.schema_version || 0) < 201) {
    return NextResponse.json({ error: "Схема экономики MXM устарела", code: "DB_SCHEMA_OUTDATED" }, { status: 503 });
  }
  const rows = (coinsResult.data || []) as Array<{ id: string; status: string; created_at: string }>;
  const active = rows.filter((coin) => coin.status === "active");
  const launchFee = Math.max(0, finiteNumber(settingsResult.data.coin_launch_fee));
  const cooldownHours = Math.max(1, finiteNumber(settingsResult.data.coin_launch_cooldown_hours, 12));
  const maxActiveCoins = Math.max(1, Math.floor(finiteNumber(settingsResult.data.coin_max_active, 2)));
  const tradeFeePercent = Math.max(0, finiteNumber(settingsResult.data.coin_total_fee_bps)) / 100;
  const wallet = monetizationResult.data && typeof monetizationResult.data === "object" && !Array.isArray(monetizationResult.data)
    ? (monetizationResult.data as { wallet?: { energy?: unknown; maxEnergy?: unknown } }).wallet
    : null;
  const lastCreatedAt = active[0]?.created_at ? safeIsoDate(active[0].created_at, "") : "";
  const lastMs = lastCreatedAt ? Date.parse(lastCreatedAt) : Number.NaN;
  const nextLaunchAt = Number.isFinite(lastMs) ? new Date(lastMs + cooldownHours * 60 * 60 * 1000) : null;
  return NextResponse.json({
    launchFee,
    cooldownHours,
    maxActiveCoins,
    activeCoins: active.length,
    nextLaunchAt: nextLaunchAt?.toISOString() || null,
    initialBuyMin: Math.max(0, finiteNumber(settingsResult.data.coin_initial_buy_min)),
    initialBuyMax: Math.max(0, finiteNumber(settingsResult.data.coin_initial_buy_max)),
    startPriceMin: Math.max(0, finiteNumber(settingsResult.data.coin_start_price_min)),
    startPriceMax: Math.max(0, finiteNumber(settingsResult.data.coin_start_price_max)),
    floorMaxBps: Math.max(0, finiteNumber(settingsResult.data.coin_floor_max_bps)),
    energyCost: Math.max(0, finiteNumber(settingsResult.data.coin_launch_energy_cost)),
    tradeFeePercent,
    energy: Math.max(0, finiteNumber(wallet?.energy)),
    maxEnergy: Math.max(1, finiteNumber(wallet?.maxEnergy, 100)),
    economyReady: true,
  }, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "coin-create", String(profile.id), 6, 600))) {
    return NextResponse.json({ error: "Слишком много запусков. Подождите несколько минут." }, { status: 429 });
  }
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.memecoins) return NextResponse.json({ error: "Мемкоины временно отключены" }, { status: 503 });

  const supabase = getSupabaseAdmin();
  const readiness = await supabase.from("economy_settings").select("schema_version,coin_initial_buy_min,coin_initial_buy_max,coin_start_price_min,coin_start_price_max,coin_floor_max_bps").eq("singleton", true).maybeSingle();
  if (readiness.error || !readiness.data || Number(readiness.data.schema_version || 0) < 201) {
    if (readiness.error) console.warn("coin create blocked: economy migration required", readiness.error.code);
    return NextResponse.json({ error: "Запуск мемкоинов временно недоступен: экономика обновляется" }, { status: 503 });
  }

  let uploadedPath: string | null = null;
  try {
    const contentType = request.headers.get("content-type") || "";
    let name = "";
    let symbol = "";
    let description = "";
    let imageUrl: string | null = null;
    let imageFile: File | null = null;
    let requestId = "";
    let initialBuy = Number.NaN;
    let startPrice = Number.NaN;
    let floorPrice = Number.NaN;

    if (contentType.includes("multipart/form-data")) {
      const form = await readFormData(request);
      if (!form) return NextResponse.json({ error: "Некорректные multipart-данные" }, { status: 400 });
      name = String(form.get("name") || "").trim();
      symbol = String(form.get("symbol") || "").trim().toUpperCase();
      description = String(form.get("description") || "").trim();
      requestId = String(form.get("requestId") || "").trim();
      initialBuy = parseEconomyAmount(form.get("initialBuy")) ?? Number.NaN;
      startPrice = parseEconomyAmount(form.get("startPrice")) ?? Number.NaN;
      floorPrice = parseEconomyAmount(form.get("floorPrice")) ?? Number.NaN;
      const image = form.get("image");
      const validationError = validate(name, symbol, description);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
      if (image instanceof File && image.size > 0) imageFile = image;
    } else {
      const body = await readJsonObject(request);
      if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
      name = String(body.name || "").trim();
      symbol = String(body.symbol || "").trim().toUpperCase();
      description = String(body.description || "").trim();
      requestId = String(body.requestId || "").trim();
      initialBuy = parseEconomyAmount(body.initialBuy) ?? Number.NaN;
      startPrice = parseEconomyAmount(body.startPrice) ?? Number.NaN;
      floorPrice = parseEconomyAmount(body.floorPrice) ?? Number.NaN;
      const validationError = validate(name, symbol, description);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    }

    if (!validUuidLike(requestId)) return NextResponse.json({ error: "Некорректный идентификатор запуска" }, { status: 400 });
    const initialBuyMin = Number(readiness.data.coin_initial_buy_min);
    const initialBuyMax = Number(readiness.data.coin_initial_buy_max);
    const startPriceMin = Number(readiness.data.coin_start_price_min);
    const startPriceMax = Number(readiness.data.coin_start_price_max);
    const floorMax = startPrice * Number(readiness.data.coin_floor_max_bps) / 10_000;
    if (!Number.isFinite(initialBuy) || initialBuy < initialBuyMin || initialBuy > initialBuyMax) {
      return NextResponse.json({ error: `Стартовый резерв: от ${initialBuyMin} до ${initialBuyMax} виртуальных TON` }, { status: 400 });
    }
    if (!Number.isFinite(startPrice) || startPrice < startPriceMin || startPrice > startPriceMax) {
      return NextResponse.json({ error: `Стартовая цена: от ${startPriceMin} до ${startPriceMax}` }, { status: 400 });
    }
    if (!Number.isFinite(floorPrice) || floorPrice < 0 || floorPrice > floorMax) {
      return NextResponse.json({ error: "Минимальная цена не может превышать 50% стартовой цены" }, { status: 400 });
    }
    if (imageFile) {
      const uploaded = await uploadCoinImage(imageFile, String(profile.id));
      uploadedPath = uploaded.path;
      imageUrl = uploaded.url;
    }

    const { data, error } = await supabase.rpc("create_coin_v200", {
      p_request_id: requestId,
      p_profile_id: profile.id,
      p_name: name,
      p_symbol: symbol,
      p_description: description,
      p_image_url: imageUrl,
      p_initial_buy: initialBuy,
      p_start_price: startPrice,
      p_floor_price: floorPrice,
    });
    if (error) {
      await removeCoinImage(uploadedPath);
      return NextResponse.json({ error: publicBusinessError(error, "Не удалось создать мемкоин с такими параметрами") }, { status: 400 });
    }
    const coinId = data && typeof data === "object" && "id" in data ? String((data as { id: unknown }).id) : "";
    if (!coinId) {
      console.error("coin create: RPC returned no id", data);
      return NextResponse.json({ error: "Мемкоин создан, но сервер вернул неполный ответ. Обновите маркет перед повторной попыткой." }, { status: 502 });
    }
    if (uploadedPath && data && typeof data === "object" && "alreadyCreated" in data && (data as { alreadyCreated?: unknown }).alreadyCreated === true) {
      await removeCoinImage(uploadedPath);
    }
    return NextResponse.json({ coin: data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await removeCoinImage(uploadedPath);
    console.error("coin create", error);
    return apiFailure(error, "Не удалось создать мемкоин");
  }
}
export const GET = withApiErrors("app/api/coins/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/coins/route.ts:POST", POSTHandler);
