import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function adminTelegramIds() {
  return new Set(
    (process.env.ADMIN_TELEGRAM_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export async function requireAdminProfile() {
  const profile = await requireProfile();
  if (!profile) return null;
  const allowed = adminTelegramIds();
  if (!allowed.size || !allowed.has(String(profile.telegram_id))) return null;
  return profile;
}

/**
 * Telegram accounts whose real unique Gift collections are used to seed the
 * public catalog. Configured by an admin via env, never invented in code.
 */
export function marketCatalogTelegramIds() {
  return [...new Set((process.env.MARKET_CATALOG_TELEGRAM_IDS || "").split(",").map((value) => value.trim()).filter(Boolean))].map(
    (value) => {
      const id = Number(value);
      if (!Number.isInteger(id) || id <= 0) throw new Error(`MARKET_CATALOG_TELEGRAM_IDS contains an invalid Telegram id: ${value}`);
      return id;
    },
  );
}

/**
 * Gets or creates the system/treasury profile that owns catalog inventory
 * synced from a configured Telegram account. Reuses the exact same profile
 * upsert path real players go through (sync_telegram_profile), then flips
 * is_system so it never shows up on the public leaderboard.
 */
export async function getOrCreateSystemProfile(telegramId: number) {
  const supabase = getSupabaseAdmin();
  const { data: profile, error } = await supabase
    .rpc("sync_telegram_profile", {
      p_telegram_id: telegramId,
      p_username: null,
      p_first_name: `Catalog #${telegramId}`,
      p_last_name: null,
      p_photo_url: null,
    })
    .single();
  if (error || !profile) throw error || new Error("Could not provision system profile");
  const record = profile as Record<string, unknown>;
  if (!record.is_system) {
    const { error: flagError } = await supabase.from("profiles").update({ is_system: true }).eq("id", record.id as string);
    if (flagError) throw flagError;
  }
  return { id: String(record.id), telegram_id: Number(record.telegram_id) };
}
