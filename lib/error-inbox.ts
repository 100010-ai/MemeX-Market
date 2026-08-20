import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function scrub(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|secret|key|signature)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, "[jwt-redacted]")
    .slice(0, 500);
}

export async function recordAppError(route: string, cause: unknown, profileId?: string | null, metadata: Record<string, unknown> = {}) {
  try {
    const error = cause instanceof Error ? cause : new Error(typeof cause === "string" ? cause : "Unknown error");
    const message = scrub(error.message || "Unknown error");
    const errorName = scrub(error.name || "Error").slice(0, 120);
    const normalized = `${route}|${errorName}|${message.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]").replace(/\d{5,}/g, "[n]")}`;
    const hash = crypto.createHash("sha256").update(normalized).digest("hex");
    const supabase = getSupabaseAdmin();
    await supabase.rpc("record_app_error_v056", {
      p_hash: hash,
      p_route: route,
      p_message: message,
      p_profile_id: profileId || null,
      p_metadata: { ...metadata, errorName },
    });
  } catch (loggingError) {
    console.error("error inbox write failed", loggingError);
  }
}
