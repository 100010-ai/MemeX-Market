import { NextResponse } from "next/server";
import { API_VERSION } from "@/lib/app-version";
import { readRequestBytesLimited, toBodyArrayBuffer } from "@/lib/http-body";

type RouteHandler<Args extends unknown[] = unknown[]> = (...args: Args) => Response | Promise<Response>;
type ErrorLike = { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };

const MAX_JSON_REQUEST_BYTES = 256 * 1024;
const MAX_FORM_REQUEST_BYTES = 4 * 1024 * 1024;

function requestId() {
  try { return globalThis.crypto?.randomUUID?.() || `mxm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
  catch { return `mxm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
}
function requestFromArgs(args: unknown[]) { const candidate = args[0]; return candidate instanceof Request ? candidate : null; }
function safeRoutePath(request: Request | null) { if (!request) return null; try { return new URL(request.url).pathname; } catch { return null; } }
function structuredApiLog(level: "info" | "warn" | "error", payload: Record<string, unknown>) { const message = `[mxm-api] ${JSON.stringify(payload)}`; if (level === "error") console.error(message); else if (level === "warn") console.warn(message); else console.info(message); }

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object" && "message" in error && typeof (error as ErrorLike).message === "string") { const message = String((error as ErrorLike).message).trim(); if (message) return message; }
  return "Internal server error";
}
export function errorCode(error: unknown) { if (!error || typeof error !== "object" || !("code" in error)) return ""; const code = (error as ErrorLike).code; return typeof code === "string" ? code.trim() : ""; }
export function publicBusinessError(error: unknown, fallback: string) {
  const message = errorMessage(error);
  if (/insufficient.*balance|not enough.*balance|недостаточно.*баланс/i.test(message)) return "Недостаточно доступного баланса.";
  if (/insufficient unreserved token|no unlocked tokens available/i.test(message)) return "Недостаточно свободных мемкоинов: часть позиции заблокирована или зарезервирована заявками.";
  if (/insufficient.*token/i.test(message)) return "Недостаточно мемкоинов для этой операции.";
  if (/trade would move price below active floor|below active floor/i.test(message)) return "Продажа опустит цену ниже активной минимальной цены мемкоина.";
  if (/coin is not tradeable/i.test(message)) return "Торговля этим мемкоином недоступна.";
  if (/insufficient.*energy|not enough.*energy/i.test(message)) return "Недостаточно энергии для этой операции.";
  if (/symbol.*already|duplicate.*symbol|coins_symbol/i.test(message)) return "Этот тикер уже занят.";
  if (/launch.*cooldown|cooldown.*launch|too soon.*launch/i.test(message)) return "До следующего запуска мемкоина нужно немного подождать.";
  if (/max.*active.*coin|active coin.*limit/i.test(message)) return "Достигнут лимит активных мемкоинов.";
  if (/already.*claim|reward.*claimed|already.*redeem/i.test(message)) return "Эта награда уже получена.";
  if (/mission.*not complete|not complete|required progress/i.test(message)) return "Задание ещё не выполнено.";
  if (/gift.*not listed|no longer listed/i.test(message)) return "Подарок уже снят с продажи.";
  if (/listing.*expired|offer.*expired/i.test(message)) return "Срок операции уже истёк.";
  if (/price moved|slippage/i.test(message)) return "Цена изменилась. Обновите данные и повторите операцию.";
  if (/already.*own|own gift/i.test(message)) return "Этот подарок уже принадлежит вам.";
  if (/duplicate|unique constraint|already exists/i.test(message)) return "Такая операция уже была выполнена.";
  if (/not found/i.test(message)) return fallback;
  return fallback;
}
export function isDatabaseSchemaError(error: unknown) { const code = errorCode(error); const message = errorMessage(error); return ["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204"].includes(code) || /schema cache|relation .* does not exist|column .* does not exist|could not find the function|function .* does not exist/i.test(message); }
export function apiFailure(error: unknown, fallback = "Внутренняя ошибка сервера", fallbackStatus = 500) {
  const schema = isDatabaseSchemaError(error);
  return NextResponse.json({ error: schema ? "База данных MXM требует актуальной production-миграции" : fallback, code: schema ? "DB_SCHEMA_OUTDATED" : fallbackStatus >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED", detail: process.env.NODE_ENV === "development" ? errorMessage(error) : undefined }, { status: schema ? 503 : fallbackStatus, headers: { "cache-control": "no-store" } });
}
function decorateResponse(response: Response, id: string, startedAt: number) { try { response.headers.set("x-mxm-request-id", id); response.headers.set("x-mxm-api-version", API_VERSION); const duration = Math.max(0, Date.now() - startedAt); const currentTiming = response.headers.get("server-timing"); response.headers.set("server-timing", currentTiming ? `${currentTiming}, mxm-route;dur=${duration}` : `mxm-route;dur=${duration}`); } catch {} return response; }
export function withApiErrors<Args extends unknown[]>(label: string, handler: RouteHandler<Args>): RouteHandler<Args> {
  return async (...args: Args) => {
    const request = requestFromArgs(args); const inboundId = request?.headers.get("x-mxm-request-id")?.trim(); const id = inboundId && /^[A-Za-z0-9._:-]{8,128}$/.test(inboundId) ? inboundId : requestId(); const startedAt = Date.now(); const method = request?.method || "UNKNOWN"; const path = safeRoutePath(request);
    try {
      const response = await handler(...args); const duration = Math.max(0, Date.now() - startedAt);
      if (response.status >= 500) structuredApiLog("error", { event: "route.response", id, label, method, path, status: response.status, durationMs: duration });
      else if (response.status >= 400) structuredApiLog("warn", { event: "route.response", id, label, method, path, status: response.status, durationMs: duration });
      else if (duration >= 1_500) structuredApiLog("warn", { event: "route.slow", id, label, method, path, status: response.status, durationMs: duration });
      return decorateResponse(response, id, startedAt);
    } catch (error) {
      structuredApiLog("error", { event: "route.exception", id, label, method, path, code: errorCode(error) || undefined, message: errorMessage(error), durationMs: Math.max(0, Date.now() - startedAt) });
      return decorateResponse(apiFailure(error), id, startedAt);
    }
  };
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const bytes = await readRequestBytesLimited(request, MAX_JSON_REQUEST_BYTES);
    if (!bytes) return null;
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export async function readFormData(request: Request): Promise<FormData | null> {
  try {
    const bytes = await readRequestBytesLimited(request, MAX_FORM_REQUEST_BYTES);
    if (!bytes) return null;
    const boundedRequest = new Request(request.url, { method: request.method, headers: request.headers, body: toBodyArrayBuffer(bytes) });
    return await boundedRequest.formData();
  } catch { return null; }
}
