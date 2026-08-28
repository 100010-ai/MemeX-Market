import { apiFailure, errorCode, errorMessage, isDatabaseSchemaError, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, safeIsoDate, text } from "@/lib/safe-data";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function caseSnapshot(value: unknown) {
  const root = object(value);
  const collectionRaw = object(root.collection);
  const statsRaw = object(collectionRaw.stats);
  const serialized = Array.isArray(collectionRaw.mine) ? collectionRaw.mine.flatMap((raw) => {
    const row = object(raw);
    const openingId = text(row.openingId, "", 80);
    const serialNumber = Math.max(0, Math.floor(finiteNumber(row.serialNumber)));
    if (!openingId || serialNumber < 1) return [];
    return [{
      openingId,
      caseSku: text(row.caseSku, "", 80),
      rarity: text(row.rarity, "epic", 32),
      rewardLabel: text(row.rewardLabel, "Награда", 160),
      serialNumber,
      mintedAt: safeIsoDate(row.mintedAt),
    }];
  }) : [];
  const serialByOpening = new Map(serialized.map((row) => [row.openingId, row.serialNumber]));

  const cases = Array.isArray(root.cases) ? root.cases.flatMap((raw) => {
    const row = object(raw);
    const sku = text(row.sku, "", 80);
    if (!sku) return [];
    const odds = Array.isArray(row.odds) ? row.odds.flatMap((rawOdd) => {
      const odd = object(rawOdd);
      const reward = text(odd.reward, "", 100);
      const label = text(odd.label, "Награда", 160);
      if (!reward) return [];
      return [{ reward, label, percent: Math.max(0, Math.min(100, finiteNumber(odd.percent))), rarity: text(odd.rarity, "common", 32) }];
    }) : [];
    const pityRaw = object(row.pity);
    const pityTier = (candidate: unknown) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
      const pity = candidate as Record<string, unknown>;
      const threshold = Math.max(1, Math.floor(finiteNumber(pity.threshold, 1)));
      return { current: Math.max(0, Math.floor(finiteNumber(pity.current))), threshold, remaining: Math.max(1, Math.floor(finiteNumber(pity.remaining, threshold))) };
    };
    return [{
      sku,
      title: text(row.title, "Кейс", 120),
      tier: text(row.tier, "starter", 32),
      description: text(row.description, "", 500),
      quantity: Math.max(0, Math.floor(finiteNumber(row.quantity))),
      remaining: row.remaining == null ? null : Math.max(0, Math.floor(finiteNumber(row.remaining))),
      pity: { rare: pityTier(pityRaw.rare), epic: pityTier(pityRaw.epic), legendary: pityTier(pityRaw.legendary), totalOpens: Math.max(0, Math.floor(finiteNumber(pityRaw.totalOpens))) },
      odds,
    }];
  }) : [];

  const history = Array.isArray(root.history) ? root.history.flatMap((raw) => {
    const row = object(raw);
    const id = text(row.id, "", 80);
    if (!id) return [];
    const serial = serialByOpening.get(id) || null;
    const rewardLabel = text(row.rewardLabel, "Награда", 160);
    return [{
      id,
      caseSku: text(row.caseSku, "", 80),
      rewardLabel: serial ? `${rewardLabel} · #${serial}` : rewardLabel,
      rarity: text(row.rarity, "common", 32),
      openedAt: safeIsoDate(row.openedAt),
      pityTriggered: Boolean(row.pityTriggered),
      pityRarity: row.pityRarity == null ? null : text(row.pityRarity, "", 32) || null,
      serialNumber: serial,
    }];
  }) : [];

  return {
    cases,
    history,
    collection: {
      stats: {
        serializedDrops: Math.max(0, Math.floor(finiteNumber(statsRaw.serializedDrops))),
        legendaryDrops: Math.max(0, Math.floor(finiteNumber(statsRaw.legendaryDrops))),
        caseSeries: Math.max(0, Math.floor(finiteNumber(statsRaw.caseSeries))),
        bestSerial: statsRaw.bestSerial == null ? null : Math.max(1, Math.floor(finiteNumber(statsRaw.bestSerial, 1))),
      },
      mine: serialized,
    },
  };
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("case_snapshot_v074", { p_profile_id: profile.id });
  if (error) {
    console.error("[cases:snapshot]", { code: errorCode(error), message: errorMessage(error), schemaMismatch: isDatabaseSchemaError(error), profileId: profile.id });
    return apiFailure(error, "Не удалось загрузить кейсы");
  }
  return NextResponse.json(caseSnapshot(data), { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "case-open", String(profile.id), 20, 60))) return NextResponse.json({ error: "Слишком много открытий. Подождите минуту." }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const caseSku = typeof body.caseSku === "string" ? body.caseSku.trim().toLowerCase() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!/^[a-z0-9_]{3,48}$/.test(caseSku)) return NextResponse.json({ error: "Некорректный кейс" }, { status: 400 });
  if (!validUuidLike(requestId)) return NextResponse.json({ error: "Некорректный идентификатор открытия" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("open_case_v074", { p_profile_id: profile.id, p_case_sku: caseSku, p_request_id: requestId });
  if (error) {
    console.error("[cases:open]", { code: errorCode(error), message: errorMessage(error), schemaMismatch: isDatabaseSchemaError(error), profileId: profile.id, caseSku, requestId });
    const message = errorMessage(error);
    const empty = /inventory|no case|case.*empty/i.test(message);
    const unavailable = /not found|inactive|no active loot/i.test(message);
    if (!empty && !unavailable) return apiFailure(error, "Не удалось открыть кейс", 400);
    return NextResponse.json({ error: empty ? "В инвентаре нет этого кейса" : "Кейс временно недоступен" }, { status: empty ? 409 : 404 });
  }
  const result = object(data);
  const collectible = object(result.collectible);
  const serialNumber = Math.max(0, Math.floor(finiteNumber(collectible.serialNumber)));
  const reward = object(result.reward);
  if (serialNumber > 0 && Object.keys(reward).length) {
    const label = text(reward.label, "Награда", 160);
    result.reward = { ...reward, label: `${label} · #${serialNumber}` };
  }
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
export const GET = withApiErrors("app/api/cases/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/cases/route.ts:POST", POSTHandler);
