import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { removeCoinImage, uploadCoinImage } from "@/lib/coin-media";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { COIN_LAUNCH_COOLDOWN_HOURS, COIN_LAUNCH_FEE_TON, COIN_MAX_ACTIVE_PER_CREATOR } from "@/lib/economy";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

function validate(name: string, symbol: string, description: string) {
  if (name.length < 2 || name.length > 32) return "Название должно содержать 2–32 символа";
  if (!/^[A-Z0-9]{2,8}$/.test(symbol)) return "Тикер должен содержать 2–8 латинских букв или цифр";
  if (description.length > 180) return "Описание слишком длинное";
  return null;
}


export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const [coinsResult, settingsResult, monetizationResult] = await Promise.all([
    supabase.from("coins").select("id,status,created_at").eq("creator_profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("economy_settings").select("schema_version,coin_launch_fee,coin_launch_cooldown_hours,coin_max_active,coin_initial_buy_min,coin_initial_buy_max,coin_start_price_min,coin_start_price_max,coin_floor_max_bps,coin_launch_energy_cost").eq("singleton", true).maybeSingle(),
    supabase.rpc("monetization_snapshot_v200", { p_profile_id: profile.id }),
  ]);
  if (coinsResult.error) {
    console.error("coin rules list", coinsResult.error);
    return NextResponse.json({ error: "Не удалось загрузить правила запуска" }, { status: 500 });
  }
  const settingsUnavailable = Boolean(settingsResult.error || monetizationResult.error || !settingsResult.data || Number(settingsResult.data.schema_version || 0) < 200);
  if (settingsResult.error && !["42P01", "42703", "PGRST204"].includes(String(settingsResult.error.code || ""))) console.error("coin economy settings", settingsResult.error);
  const rows = (coinsResult.data || []) as Array<{ id: string; status: string; created_at: string }>;
  const active = rows.filter((coin) => coin.status === "active");
  const launchFee = settingsResult.data ? Number(settingsResult.data.coin_launch_fee) : COIN_LAUNCH_FEE_TON;
  const cooldownHours = settingsResult.data ? Number(settingsResult.data.coin_launch_cooldown_hours) : COIN_LAUNCH_COOLDOWN_HOURS;
  const maxActiveCoins = settingsResult.data ? Number(settingsResult.data.coin_max_active) : COIN_MAX_ACTIVE_PER_CREATOR;
  const wallet = monetizationResult.data && typeof monetizationResult.data === "object" && !Array.isArray(monetizationResult.data)
    ? (monetizationResult.data as { wallet?: { energy?: unknown; maxEnergy?: unknown } }).wallet
    : null;
  const last = active[0]?.created_at ? new Date(active[0].created_at) : null;
  const nextLaunchAt = last ? new Date(last.getTime() + cooldownHours * 60 * 60 * 1000) : null;
  return NextResponse.json({
    launchFee,
    cooldownHours,
    maxActiveCoins,
    activeCoins: active.length,
    nextLaunchAt: nextLaunchAt?.toISOString() || null,
    initialBuyMin: settingsResult.data ? Number(settingsResult.data.coin_initial_buy_min) : 1,
    initialBuyMax: settingsResult.data ? Number(settingsResult.data.coin_initial_buy_max) : 1_000,
    startPriceMin: settingsResult.data ? Number(settingsResult.data.coin_start_price_min) : 0.00000001,
    startPriceMax: settingsResult.data ? Number(settingsResult.data.coin_start_price_max) : 0.000001,
    floorMaxBps: settingsResult.data ? Number(settingsResult.data.coin_floor_max_bps) : 5_000,
    energyCost: settingsResult.data ? Number(settingsResult.data.coin_launch_energy_cost) : 20,
    energy: Number(wallet?.energy ?? 0),
    maxEnergy: Number(wallet?.maxEnergy ?? 100),
    economyReady: !settingsUnavailable,
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
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
  if (readiness.error || !readiness.data || Number(readiness.data.schema_version || 0) < 200) {
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
      const form = await request.formData();
      name = String(form.get("name") || "").trim();
      symbol = String(form.get("symbol") || "").trim().toUpperCase();
      description = String(form.get("description") || "").trim();
      requestId = String(form.get("requestId") || "").trim();
      initialBuy = Number(form.get("initialBuy"));
      startPrice = Number(form.get("startPrice"));
      floorPrice = Number(form.get("floorPrice"));
      const image = form.get("image");
      const validationError = validate(name, symbol, description);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
      if (image instanceof File && image.size > 0) imageFile = image;
    } else {
      const body = await request.json();
      name = String(body.name || "").trim();
      symbol = String(body.symbol || "").trim().toUpperCase();
      description = String(body.description || "").trim();
      requestId = String(body.requestId || "").trim();
      initialBuy = Number(body.initialBuy);
      startPrice = Number(body.startPrice);
      floorPrice = Number(body.floorPrice);
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
      return NextResponse.json({ error: `Первичная покупка: от ${initialBuyMin} до ${initialBuyMax} виртуальных TON` }, { status: 400 });
    }
    if (!Number.isFinite(startPrice) || startPrice < startPriceMin || startPrice > startPriceMax) {
      return NextResponse.json({ error: `Стартовая цена: от ${startPriceMin} до ${startPriceMax}` }, { status: 400 });
    }
    if (!Number.isFinite(floorPrice) || floorPrice < 0 || floorPrice > floorMax) {
      return NextResponse.json({ error: "Floor не может превышать 50% стартовой цены" }, { status: 400 });
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
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const coinId = data && typeof data === "object" && "id" in data ? String((data as { id: unknown }).id) : "";
    if (!coinId) {
      // The RPC is atomic: if it succeeded, do not delete an uploaded logo or attempt a second mutation.
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать мемкоин" }, { status: 500 });
  }
}
