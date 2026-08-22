export type StoreCategory = "currency" | "membership" | "season" | "cases" | "creator" | "profile" | "energy";

export type StoreProduct = {
  sku: string;
  category: StoreCategory;
  title: string;
  description: string;
  stars: number;
  rewardLabel: string;
  badge: string | null;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

const categories = new Set<StoreCategory>(["currency", "membership", "season", "cases", "creator", "profile", "energy"]);

export function normalizeStoreProduct(row: Record<string, unknown>): StoreProduct | null {
  const category = typeof row.category === "string" ? row.category.trim() : "";
  const sku = typeof row.sku === "string" ? row.sku.trim() : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (!categories.has(category as StoreCategory) || !sku || !title) return null;
  const stars = Number(row.stars_price);
  const sortOrder = Number(row.sort_order ?? 0);
  if (!Number.isInteger(stars) || stars < 5 || stars > 100_000 || !Number.isFinite(sortOrder)) return null;
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  return {
    sku,
    category: category as StoreCategory,
    title,
    description: String(row.description || ""),
    stars,
    rewardLabel: String(row.reward_label || ""),
    badge: row.badge == null ? null : String(row.badge),
    sortOrder,
    metadata,
  };
}
