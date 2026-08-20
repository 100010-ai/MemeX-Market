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

/**
 * Public fallback catalogue used while the v2 migration is rolling out.
 * The database remains authoritative for prices and fulfilment: a fallback
 * product is visible in the UI, but cannot be purchased until the API confirms
 * that the matching active row exists in store_products.
 */
export const STORE_PRODUCTS: readonly StoreProduct[] = [
  { sku: "mxm_starter", category: "currency", title: "Starter Pack", description: "Быстрый старт для первых покупок и кейсов.", stars: 50, rewardLabel: "1 000 MXM Coins", badge: null, sortOrder: 10, metadata: { mxmCoins: 1_000 } },
  { sku: "mxm_trader", category: "currency", title: "Trader Pack", description: "Запас валюты для активного сезона.", stars: 180, rewardLabel: "5 000 MXM Coins", badge: "+10%", sortOrder: 20, metadata: { mxmCoins: 5_000 } },
  { sku: "mxm_whale", category: "currency", title: "Whale Pack", description: "Крупный пакет с повышенной выгодой.", stars: 650, rewardLabel: "25 000 MXM Coins", badge: "Выгодно", sortOrder: 30, metadata: { mxmCoins: 25_000 } },
  { sku: "mxm_investor", category: "currency", title: "Investor Pack", description: "Максимальный запас внутренней валюты.", stars: 1_990, rewardLabel: "100 000 MXM Coins", badge: "Максимум", sortOrder: 40, metadata: { mxmCoins: 100_000 } },
  { sku: "premium_30d", category: "membership", title: "MXM Premium", description: "30 дней: ежедневный бонус, 150 Energy, расширенный Watchlist и премиальная рамка.", stars: 299, rewardLabel: "30 дней Premium", badge: "Premium", sortOrder: 50, metadata: { entitlement: "premium", durationDays: 30 } },
  { sku: "season_premium", category: "season", title: "Premium Track", description: "Премиальная дорожка текущего 30-дневного сезона.", stars: 199, rewardLabel: "Premium Battle Pass", badge: "Season", sortOrder: 60, metadata: { entitlement: "season_pass" } },
  { sku: "case_starter", category: "cases", title: "Starter Case", description: "MXM Coins, Energy и обычные коллекционные предметы.", stars: 25, rewardLabel: "1 Starter Case", badge: null, sortOrder: 70, metadata: { caseTier: "starter", quantity: 1 } },
  { sku: "case_rare", category: "cases", title: "Rare Case", description: "Редкие предметы и увеличенные награды. Шансы видны до открытия.", stars: 79, rewardLabel: "1 Rare Case", badge: "Rare", sortOrder: 80, metadata: { caseTier: "rare", quantity: 1 } },
  { sku: "case_legendary", category: "cases", title: "Legendary Case", description: "Эксклюзивная коллекция и самые редкие награды.", stars: 199, rewardLabel: "1 Legendary Case", badge: "Legendary", sortOrder: 90, metadata: { caseTier: "legendary", quantity: 1 } },
  { sku: "energy_refill", category: "energy", title: "Energy Refill", description: "Мгновенно восстанавливает Energy до максимума.", stars: 20, rewardLabel: "Полная Energy", badge: null, sortOrder: 100, metadata: { energyRefill: true } },
  { sku: "creator_boost_24h", category: "creator", title: "Coin Boost", description: "Поднимает ваш мемкоин в New Coins и визуально выделяет карточку на 24 часа.", stars: 99, rewardLabel: "Boost на 24 часа", badge: "Creator", sortOrder: 110, metadata: { creatorTool: "boost", durationHours: 24, requiresCoin: true } },
  { sku: "creator_verified_30d", category: "creator", title: "Verified Creator", description: "Верификация профиля создателя и повышенное доверие на 30 дней.", stars: 349, rewardLabel: "Verified на 30 дней", badge: "Verified", sortOrder: 120, metadata: { entitlement: "creator_verified", durationDays: 30 } },
  { sku: "creator_analytics_30d", category: "creator", title: "Advanced Analytics", description: "Расширенные графики, источники покупателей и удержание на 30 дней.", stars: 249, rewardLabel: "Analytics на 30 дней", badge: null, sortOrder: 130, metadata: { entitlement: "creator_analytics", durationDays: 30 } },
  { sku: "profile_neon_frame", category: "profile", title: "Neon Frame", description: "Постоянная анимированная рамка профиля.", stars: 89, rewardLabel: "Предмет профиля", badge: "Limited", sortOrder: 140, metadata: { profileItem: "neon_frame", itemType: "frame" } },
] as const;

const categories = new Set<StoreCategory>(["currency", "membership", "season", "cases", "creator", "profile", "energy"]);

export function normalizeStoreProduct(row: Record<string, unknown>): StoreProduct {
  const category = String(row.category || "");
  if (!categories.has(category as StoreCategory)) throw new Error("Invalid store category");
  const stars = Number(row.stars_price);
  const sortOrder = Number(row.sort_order ?? 0);
  if (!Number.isInteger(stars) || stars < 5 || stars > 100_000 || !Number.isFinite(sortOrder)) throw new Error("Invalid store price");
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  return {
    sku: String(row.sku),
    category: category as StoreCategory,
    title: String(row.title),
    description: String(row.description || ""),
    stars,
    rewardLabel: String(row.reward_label || ""),
    badge: row.badge == null ? null : String(row.badge),
    sortOrder,
    metadata,
  };
}

export function fallbackStoreProduct(sku: string) {
  return STORE_PRODUCTS.find((product) => product.sku === sku) ?? null;
}
