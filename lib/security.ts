import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function securitySecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET должен содержать минимум 32 символа");
  return value;
}

export function sameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return false;
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  // Some Telegram WebViews omit Origin on same-origin fetches. Sec-Fetch-Site
  // still lets us reject explicit cross-site mutations without breaking those
  // legitimate clients. Requests with neither header are accepted because
  // authenticated mutations also require the signed HttpOnly session cookie.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  return true;
}

export function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function securityKey(...parts: Array<string | number | null | undefined>) {
  return crypto.createHmac("sha256", securitySecret()).update(parts.map((part) => String(part ?? "")).join("|")).digest("hex");
}

export async function enforceRateLimit(request: Request, scope: string, actor: string | number, limit: number, windowSeconds: number) {
  // The actor-only bucket prevents a client from resetting its quota by
  // rotating/spoofing forwarded IPs. The actor+IP bucket remains useful for
  // incident analysis and constrains one device/network path independently.
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("consume_rate_limits_v070", {
    p_keys: [
      securityKey(scope, "actor", actor),
      securityKey(scope, "actor-ip", actor, requestIp(request)),
    ],
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data === true;
}

export function validUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function safeSecretEquals(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const actualDigest = crypto.createHash("sha256").update(actual).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}
