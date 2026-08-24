import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const MARKET_CART_LIMIT = 20;
const CART_SCAN_LIMIT = 100;

type CartStateOptions = {
  playerOnly?: boolean;
};

function cleanId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Reconcile cart capacity against listings that are still actually buyable.
 * Cart rows are only a convenience pointer and can outlive a listing after a
 * sale, expiry, burn, delist or a player-only liquidity transition.
 */
export async function getCleanMarketCartIds(profileId: string, options: CartStateOptions = {}) {
  const supabase = getSupabaseAdmin();
  const cart = await supabase
    .from("market_cart_items")
    .select("virtual_gift_id,added_at")
    .eq("profile_id", profileId)
    .order("added_at", { ascending: true })
    .limit(CART_SCAN_LIMIT + 1);
  if (cart.error) throw cart.error;

  const rawRows = cart.data || [];
  const overflow = rawRows.length > CART_SCAN_LIMIT;
  const ids = rawRows.slice(0, CART_SCAN_LIMIT).map((row) => cleanId(row.virtual_gift_id)).filter(Boolean);
  if (!ids.length) return { ids: [] as string[], removed: 0, overflow };

  const nowIso = new Date().toISOString();
  const listings = await supabase
    .from("gift_market_overview")
    .select("virtual_gift_id,owner_profile_id,status,listing_price,listing_expires_at,is_burned")
    .in("virtual_gift_id", ids)
    .eq("status", "listed")
    .eq("is_burned", false)
    .not("listing_price", "is", null)
    .or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`);
  if (listings.error) throw listings.error;

  const rows = listings.data || [];
  const systemOwners = new Set<string>();
  if (options.playerOnly) {
    const ownerIds = [...new Set(rows.map((row) => cleanId(row.owner_profile_id)).filter(Boolean))];
    if (ownerIds.length) {
      const owners = await supabase.from("profiles").select("id,is_system").in("id", ownerIds);
      if (owners.error) throw owners.error;
      for (const owner of owners.data || []) if (owner.is_system === true) systemOwners.add(String(owner.id));
    }
  }

  const active = new Set(rows.flatMap((row) => {
    const id = cleanId(row.virtual_gift_id);
    const ownerId = cleanId(row.owner_profile_id);
    if (!id || ownerId === profileId || (options.playerOnly && systemOwners.has(ownerId))) return [];
    return [id];
  }));
  const stale = ids.filter((id) => !active.has(id));
  if (stale.length) {
    const removed = await supabase
      .from("market_cart_items")
      .delete()
      .eq("profile_id", profileId)
      .in("virtual_gift_id", stale);
    if (removed.error) throw removed.error;
  }

  return {
    ids: ids.filter((id) => active.has(id)),
    removed: stale.length,
    overflow,
  };
}
