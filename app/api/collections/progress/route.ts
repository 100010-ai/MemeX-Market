import { apiFailure, errorMessage, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, text } from "@/lib/safe-data";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function trait(value: unknown) {
  const row = object(value);
  return { owned: Math.max(0, Math.floor(finiteNumber(row.owned))), total: Math.max(0, Math.floor(finiteNumber(row.total))) };
}

function snapshot(value: unknown) {
  const root = object(value);
  const collections = Array.isArray(root.collections) ? root.collections.flatMap((raw) => {
    const row = object(raw);
    const baseName = text(row.baseName, "", 120);
    if (!baseName) return [];
    const claimedMilestones = Array.isArray(row.claimedMilestones)
      ? row.claimedMilestones.map((item) => Math.floor(finiteNumber(item))).filter((item) => [25, 50, 75, 100].includes(item))
      : [];
    return [{
      baseName,
      coverage: Math.max(0, Math.min(100, Math.floor(finiteNumber(row.coverage)))),
      owned: Math.max(0, Math.floor(finiteNumber(row.owned))),
      rarityPoints: Math.max(0, Math.floor(finiteNumber(row.rarityPoints))),
      holders: Math.max(0, Math.floor(finiteNumber(row.holders))),
      floorPrice: row.floorPrice == null ? null : Math.max(0, finiteNumber(row.floorPrice)),
      models: trait(row.models),
      backdrops: trait(row.backdrops),
      symbols: trait(row.symbols),
      claimedMilestones: [...new Set(claimedMilestones)].sort((a, b) => a - b),
    }];
  }) : [];
  return {
    level: Math.max(1, Math.floor(finiteNumber(root.level, 1))),
    totalPoints: Math.max(0, Math.floor(finiteNumber(root.totalPoints))),
    nextLevel: Math.max(1, Math.floor(finiteNumber(root.nextLevel, 5))),
    progress: Math.max(0, Math.min(1, finiteNumber(root.progress))),
    giftCount: Math.max(0, Math.floor(finiteNumber(root.giftCount))),
    completed: Math.max(0, Math.floor(finiteNumber(root.completed))),
    milestones: Array.isArray(root.milestones) ? root.milestones.map((item) => Math.floor(finiteNumber(item))).filter((item) => [25, 50, 75, 100].includes(item)) : [25, 50, 75, 100],
    collections,
  };
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("collection_book_snapshot_v064", { p_profile_id: profile.id });
  if (error) return apiFailure(error, "Не удалось загрузить Collection Book");
  return NextResponse.json(snapshot(data), { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "collection-bonus", String(profile.id), 16, 300))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const baseName = typeof body.baseName === "string" ? body.baseName.trim() : "";
  if (baseName.length < 1 || baseName.length > 120) return NextResponse.json({ error: "Некорректная коллекция" }, { status: 400 });
  const milestone = Number(body.milestone);
  const supabase = getSupabaseAdmin();

  if (Number.isInteger(milestone) && [25, 50, 75, 100].includes(milestone)) {
    const { data, error } = await supabase.rpc("claim_collection_milestone_v064", { p_profile_id: profile.id, p_base_name: baseName, p_milestone: milestone });
    if (error) {
      const message = errorMessage(error);
      if (/locked/i.test(message)) return NextResponse.json({ error: `Нужно собрать ${milestone}% этой коллекции` }, { status: 409 });
      return apiFailure(error, "Не удалось получить награду Collection Book", 400);
    }
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  }

  // Compatibility path for old clients still using the pre-v0.64 completion bonus.
  const { data, error } = await supabase.rpc("claim_collection_bonus_v200", { p_profile_id: profile.id, p_base_name: baseName });
  if (error) {
    const message = errorMessage(error);
    const incomplete = /not complete|required|unique/i.test(message);
    const claimed = /already|duplicate/i.test(message);
    if (!incomplete && !claimed) return apiFailure(error, "Не удалось получить бонус коллекции", 400);
    return NextResponse.json({ error: incomplete ? "Серия ещё не собрана" : "Бонус этой серии уже получен" }, { status: 409 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}

export const GET = withApiErrors("app/api/collections/progress/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/collections/progress/route.ts:POST", POSTHandler);
