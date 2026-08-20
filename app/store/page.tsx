import { StoreFront } from "@/components/store-front";
import type { StoreCategory } from "@/lib/store";

const categories = new Set<StoreCategory>(["currency", "membership", "season", "cases", "energy", "creator", "profile"]);

export default async function StorePage({ searchParams }: { searchParams: Promise<{ category?: string | string[] }> }) {
  const rawCategory = (await searchParams).category;
  const requested = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;
  const initialCategory = categories.has(requested as StoreCategory) ? requested as StoreCategory : "currency";
  return <StoreFront initialCategory={initialCategory} />;
}
