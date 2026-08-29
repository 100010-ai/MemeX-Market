import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";


type ProfileItemDefinition = {
  item_key: string;
  item_type: string;
  title: string;
  rarity: string;
  active: boolean;
};

type ProfileItemGrant = {
  item_key: string;
  acquired_at: string;
  source: string | null;
};

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });

  const admin = getSupabaseAdmin();
  // Wallet/VIP data still comes from the consolidated snapshot, but cosmetics are
  // read from their canonical inventory table. This makes a frame visible on the
  // very next request after a case grants it instead of depending on a secondary
  // snapshot projection being current.
  const [snapshot, inventory, equipped] = await Promise.all([
    admin.rpc("monetization_snapshot_v200", { p_profile_id: profile.id }),
    admin
      .from("profile_item_inventory")
      .select("item_key,acquired_at,source")
      .eq("profile_id", profile.id)
      .order("acquired_at", { ascending: false })
      .limit(300),
    admin.from("profiles").select("equipped_profile_frame").eq("id", profile.id).single(),
  ]);

  if (snapshot.error) return apiFailure(snapshot.error, "Не удалось загрузить оформление профиля");
  if (inventory.error) return apiFailure(inventory.error, "Не удалось загрузить полученные предметы");
  if (equipped.error) return apiFailure(equipped.error, "Не удалось загрузить выбранную рамку");

  const grants = (inventory.data || []) as ProfileItemGrant[];
  const itemKeys = [...new Set(grants.map((item) => item.item_key).filter(Boolean))];
  let definitions: ProfileItemDefinition[] = [];
  if (itemKeys.length) {
    const definitionResult = await admin
      .from("profile_items")
      .select("item_key,item_type,title,rarity,active")
      .in("item_key", itemKeys)
      .eq("active", true);
    if (definitionResult.error) return apiFailure(definitionResult.error, "Не удалось загрузить каталог оформления");
    definitions = (definitionResult.data || []) as ProfileItemDefinition[];
  }

  const definitionByKey = new Map(definitions.map((item) => [item.item_key, item]));
  const equippedFrame = typeof equipped.data?.equipped_profile_frame === "string" ? equipped.data.equipped_profile_frame : null;
  const items = grants.flatMap((grant) => {
    const definition = definitionByKey.get(grant.item_key);
    if (!definition) return [];
    return [{
      key: definition.item_key,
      type: definition.item_type,
      title: definition.title,
      rarity: definition.rarity,
      equipped: definition.item_type === "frame" && definition.item_key === equippedFrame,
      acquiredAt: grant.acquired_at,
      source: grant.source,
    }];
  }).sort((left, right) => {
    if (left.type === "frame" && right.type !== "frame") return -1;
    if (left.type !== "frame" && right.type === "frame") return 1;
    return String(right.acquiredAt).localeCompare(String(left.acquiredAt));
  });

  const payload = snapshot.data && typeof snapshot.data === "object" && !Array.isArray(snapshot.data)
    ? snapshot.data as Record<string, unknown>
    : {};
  return NextResponse.json(
    { wallet: payload.wallet || {}, items },
    { headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache" } },
  );
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "profile-cosmetic", String(profile.id), 20, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = body.action == null ? "equip" : body.action === "equip" || body.action === "reset" ? body.action : null;
  if (!action) return NextResponse.json({ error: "Некорректное действие с оформлением" }, { status: 400 });
  if (action === "reset") {
    if (body.key != null) return NextResponse.json({ error: "Для снятия рамки предмет не указывается" }, { status: 400 });
    const reset = await getSupabaseAdmin().from("profiles").update({ equipped_profile_frame: null, updated_at: new Date().toISOString() }).eq("id", profile.id).select("equipped_profile_frame").single();
    if (reset.error) return apiFailure(reset.error, "Не удалось снять рамку");
    return NextResponse.json({ status: "unequipped", key: null }, { headers: { "cache-control": "no-store" } });
  }
  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  if (!/^[a-z0-9:_-]{3,80}$/.test(key)) return NextResponse.json({ error: "Некорректный предмет" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("equip_profile_item_v200", { p_profile_id: profile.id, p_item_key: key });
  if (error) {
    console.error("profile cosmetic", error);
    const notOwned = /not owned/i.test(error.message || "");
    const wrongType = /only profile frames|only.*frame/i.test(error.message || "");
    if (!notOwned && !wrongType) return apiFailure(error, "Не удалось применить оформление", 400);
    return NextResponse.json({ error: notOwned ? "Предмет не принадлежит профилю" : "Можно выбрать только рамку профиля" }, { status: notOwned ? 403 : 409 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
export const GET = withApiErrors("app/api/profile/customize/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/profile/customize/route.ts:POST", POSTHandler);
