import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { removeCoinImage, uploadCoinImage } from "@/lib/coin-media";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { COIN_LAUNCH_COOLDOWN_HOURS, COIN_LAUNCH_FEE_TON, COIN_MAX_ACTIVE_PER_CREATOR } from "@/lib/economy";

export const runtime = "nodejs";

function validate(name: string, symbol: string, description: string) {
  if (name.length < 2 || name.length > 32) return "Название должно содержать 2–32 символа";
  if (!/^[A-Z0-9]{2,8}$/.test(symbol)) return "Тикер должен содержать 2–8 латинских букв или цифр";
  if (description.length > 180) return "Описание слишком длинное";
  return null;
}


export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data: coins, error } = await supabase
    .from("coins")
    .select("id,status,created_at")
    .eq("creator_profile_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (coins || []) as Array<{ id: string; status: string; created_at: string }>;
  const active = rows.filter((coin) => coin.status === "active");
  const last = active[0]?.created_at ? new Date(active[0].created_at) : null;
  const nextLaunchAt = last ? new Date(last.getTime() + COIN_LAUNCH_COOLDOWN_HOURS * 60 * 60 * 1000) : null;
  return NextResponse.json({
    launchFee: COIN_LAUNCH_FEE_TON,
    cooldownHours: COIN_LAUNCH_COOLDOWN_HOURS,
    maxActiveCoins: COIN_MAX_ACTIVE_PER_CREATOR,
    activeCoins: active.length,
    nextLaunchAt: nextLaunchAt?.toISOString() || null,
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "coin-create", String(profile.id), 6, 600))) {
    return NextResponse.json({ error: "Слишком много запусков. Подождите несколько минут." }, { status: 429 });
  }

  let uploadedPath: string | null = null;
  try {
    const contentType = request.headers.get("content-type") || "";
    let name = "";
    let symbol = "";
    let description = "";
    let imageUrl: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      name = String(form.get("name") || "").trim();
      symbol = String(form.get("symbol") || "").trim().toUpperCase();
      description = String(form.get("description") || "").trim();
      const image = form.get("image");
      const validationError = validate(name, symbol, description);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
      if (image instanceof File && image.size > 0) {
        const uploaded = await uploadCoinImage(image, String(profile.id));
        uploadedPath = uploaded.path;
        imageUrl = uploaded.url;
      }
    } else {
      const body = await request.json();
      name = String(body.name || "").trim();
      symbol = String(body.symbol || "").trim().toUpperCase();
      description = String(body.description || "").trim();
      const validationError = validate(name, symbol, description);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("create_coin_with_image", {
      p_profile_id: profile.id,
      p_name: name,
      p_symbol: symbol,
      p_description: description,
      p_image_url: imageUrl,
    });
    if (error) {
      await removeCoinImage(uploadedPath);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const coinId = data && typeof data === "object" && "id" in data ? String((data as { id: unknown }).id) : "";
    if (!coinId) {
      await removeCoinImage(uploadedPath);
      return NextResponse.json({ error: "Сервер не вернул ID созданного мемкоина" }, { status: 500 });
    }
    const { error: visibilityError } = await supabase.from("coins").update({ status: "active", hidden_from_market: false }).eq("id", coinId);
    if (visibilityError) {
      console.error("coin visibility", visibilityError);
      return NextResponse.json({ error: "Мемкоин создан, но не удалось включить его в маркет. Проверь миграцию v0.10." }, { status: 500 });
    }
    return NextResponse.json({ coin: data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await removeCoinImage(uploadedPath);
    console.error("coin create", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать мемкоин" }, { status: 500 });
  }
}
