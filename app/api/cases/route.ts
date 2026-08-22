import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { finiteNumber, safeIsoDate, text } from "@/lib/safe-data";


function caseSnapshot(value: unknown) {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const cases = Array.isArray(root.cases) ? root.cases.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const sku = text(row.sku, "", 80);
    if (!sku) return [];
    const odds = Array.isArray(row.odds) ? row.odds.flatMap((rawOdd) => {
      if (!rawOdd || typeof rawOdd !== "object" || Array.isArray(rawOdd)) return [];
      const odd = rawOdd as Record<string, unknown>;
      const reward = text(odd.reward, "", 100);
      const label = text(odd.label, "Награда", 160);
      if (!reward) return [];
      return [{ reward, label, percent: Math.max(0, Math.min(100, finiteNumber(odd.percent))), rarity: text(odd.rarity, "common", 32) }];
    }) : [];
    return [{
      sku,
      title: text(row.title, "Кейс", 120),
      tier: text(row.tier, "starter", 32),
      description: text(row.description, "", 500),
      quantity: Math.max(0, Math.floor(finiteNumber(row.quantity))),
      remaining: row.remaining == null ? null : Math.max(0, Math.floor(finiteNumber(row.remaining))),
      odds,
    }];
  }) : [];
  const history = Array.isArray(root.history) ? root.history.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const id = text(row.id, "", 80);
    if (!id) return [];
    return [{ id, caseSku: text(row.caseSku, "", 80), rewardLabel: text(row.rewardLabel, "Награда", 160), rarity: text(row.rarity, "common", 32), openedAt: safeIsoDate(row.openedAt) }];
  }) : [];
  return { cases, history };
}


async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("case_snapshot_v200", { p_profile_id: profile.id });
  if (error) return apiFailure(error, "Не удалось загрузить кейсы");
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
  const { data, error } = await getSupabaseAdmin().rpc("open_case_v200", { p_profile_id: profile.id, p_case_sku: caseSku, p_request_id: requestId });
  if (error) {
    console.error("case open", error);
    const empty = /inventory|no case|case.*empty/i.test(error.message || "");
    const unavailable = /not found|inactive|no active loot/i.test(error.message || "");
    if (!empty && !unavailable) return apiFailure(error, "Не удалось открыть кейс", 400);
    return NextResponse.json({ error: empty ? "В инвентаре нет этого кейса" : "Кейс временно недоступен" }, { status: empty ? 409 : 404 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
export const GET = withApiErrors("app/api/cases/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/cases/route.ts:POST", POSTHandler);
