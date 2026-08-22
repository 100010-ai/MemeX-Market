import { NextResponse } from "next/server";

type RouteHandler<Args extends unknown[] = unknown[]> = (...args: Args) => Response | Promise<Response>;

type ErrorLike = { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object" && "message" in error && typeof (error as ErrorLike).message === "string") {
    const message = String((error as ErrorLike).message).trim();
    if (message) return message;
  }
  return "Internal server error";
}

export function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = (error as ErrorLike).code;
  return typeof code === "string" ? code.trim() : "";
}

/** PostgREST/Postgres errors that indicate application code and DB migrations are out of sync. */
export function isDatabaseSchemaError(error: unknown) {
  const code = errorCode(error);
  const message = errorMessage(error);
  return ["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204"].includes(code)
    || /schema cache|relation .* does not exist|column .* does not exist|could not find the function|function .* does not exist/i.test(message);
}

/**
 * Serialize a server/database failure without leaking Supabase internals.
 * Missing migrations are service-unavailable (503), not a generic 500.
 */
export function apiFailure(error: unknown, fallback = "Внутренняя ошибка сервера", fallbackStatus = 500) {
  const schema = isDatabaseSchemaError(error);
  return NextResponse.json(
    {
      error: schema ? "База данных MXM требует актуальной production-миграции" : fallback,
      code: schema ? "DB_SCHEMA_OUTDATED" : fallbackStatus >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED",
      detail: process.env.NODE_ENV === "development" ? errorMessage(error) : undefined,
    },
    { status: schema ? 503 : fallbackStatus, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Last-resort guard for App Router API handlers.
 * Business/validation errors should still be handled inside each route with an
 * explicit status. This wrapper only guarantees that an unexpected exception
 * is logged and serialized as JSON instead of leaking a Next.js HTML 500 page.
 */
export function withApiErrors<Args extends unknown[]>(label: string, handler: RouteHandler<Args>): RouteHandler<Args> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(`[api:${label}]`, error);
      return apiFailure(error);
    }
  };
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function readFormData(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}
