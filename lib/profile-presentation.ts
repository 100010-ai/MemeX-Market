import type { ProfileBadge } from "@/lib/types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function mapProfileBadges(value: unknown): ProfileBadge[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): ProfileBadge[] => {
    const row = record(raw);
    const joined = Array.isArray(row.profile_items) ? row.profile_items[0] : row.profile_items;
    const item = record(joined);
    const key = typeof row.item_key === "string" ? row.item_key : "";
    const title = typeof item.title === "string" ? item.title : "";
    if (!key || !title || item.item_type !== "badge" || item.active === false) return [];
    return [{ key, title, rarity: typeof item.rarity === "string" ? item.rarity : "common" }];
  });
}
