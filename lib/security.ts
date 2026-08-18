import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function securitySecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET должен содержать минимум 32 символа");
  return value;
}

export function sameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}

export function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function securityKey(...parts: Array<string | number | null | undefined>) {
  return crypto.createHmac("sha256", securitySecret()).update(parts.map((part) => String(part ?? "")).join("|")).digest("hex");
}

export async function consumeRateLimit(key: string, limit: number, windowSeconds: number) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data === true;
}

export async function enforceRateLimit(request: Request, scope: string, actor: string | number, limit: number, windowSeconds: number) {
  const key = securityKey(scope, actor, requestIp(request));
  return consumeRateLimit(key, limit, windowSeconds);
}

export function validUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
