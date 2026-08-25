import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const ADMIN_PERMISSIONS = [
  "analytics.read",
  "players.manage",
  "economy.manage",
  "coins.manage",
  "gifts.manage",
  "catalog.manage",
  "promos.manage",
  "missions.manage",
  "risk.read",
  "health.read",
  "runtime.manage",
  "admins.manage",
  "audit.read",
  "assets.manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type AdminRole = "owner" | "operator" | "moderator" | "analyst";

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  owner: ADMIN_PERMISSIONS,
  operator: ["analytics.read", "players.manage", "coins.manage", "gifts.manage", "catalog.manage", "promos.manage", "missions.manage", "risk.read", "health.read", "audit.read", "assets.manage"],
  moderator: ["analytics.read", "players.manage", "coins.manage", "gifts.manage", "risk.read", "audit.read"],
  analyst: ["analytics.read", "risk.read", "health.read", "audit.read"],
};

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  owner: "Владелец",
  operator: "Оператор",
  moderator: "Модератор",
  analyst: "Аналитик",
};

export type AdminProfile = NonNullable<Awaited<ReturnType<typeof requireProfile>>> & {
  adminRole: AdminRole;
  adminPermissions: AdminPermission[];
  adminSource: "environment" | "database";
};

function adminTelegramIds() {
  return new Set(
    (process.env.ADMIN_TELEGRAM_IDS || "")
      .split(",")
      .map((value: string) => value.trim())
      .filter(Boolean),
  );
}

function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && value in ADMIN_ROLE_PERMISSIONS;
}

function validPermissions(value: unknown): AdminPermission[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(ADMIN_PERMISSIONS);
  return [...new Set(value.filter((permission): permission is AdminPermission => typeof permission === "string" && allowed.has(permission)))];
}

export function adminCan(admin: AdminProfile | null, permission: AdminPermission) {
  return Boolean(admin?.adminPermissions.includes(permission));
}

export async function requireAdminProfile(permission?: AdminPermission): Promise<AdminProfile | null> {
  const profile = await requireProfile();
  if (!profile) return null;
  const allowed = adminTelegramIds();
  if (allowed.has(String(profile.telegram_id))) {
    const admin = { ...profile, adminRole: "owner" as const, adminPermissions: [...ADMIN_PERMISSIONS], adminSource: "environment" as const };
    return !permission || admin.adminPermissions.includes(permission) ? admin : null;
  }

  const supabase = getSupabaseAdmin();
  const membership = await supabase.from("admin_members_v067")
    .select("role,permissions,active")
    .eq("profile_id", profile.id)
    .eq("active", true)
    .maybeSingle();
  if (membership.error || !membership.data || !isAdminRole(membership.data.role)) return null;

  const customPermissions = validPermissions(membership.data.permissions);
  const admin: AdminProfile = {
    ...profile,
    adminRole: membership.data.role,
    adminPermissions: customPermissions.length ? customPermissions : [...ADMIN_ROLE_PERMISSIONS[membership.data.role]],
    adminSource: "database",
  };
  return !permission || admin.adminPermissions.includes(permission) ? admin : null;
}
