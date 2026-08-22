import { NextResponse } from "next/server";

type RouteHandler<Args extends unknown[] = unknown[]> = (...args: Args) => Response | Promise<Response>;

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return String((error as { message: string }).message);
  }
  return "Internal server error";
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
      return NextResponse.json(
        { error: "Внутренняя ошибка сервера", detail: process.env.NODE_ENV === "development" ? errorMessage(error) : undefined },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
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
