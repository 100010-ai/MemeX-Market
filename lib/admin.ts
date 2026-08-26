import { requireProfile } from "@/lib/auth";

function adminTelegramIds() {
  return new Set(
    (process.env.ADMIN_TELEGRAM_IDS || "")
      .split(",")
      .map((value: string) => value.trim())
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
