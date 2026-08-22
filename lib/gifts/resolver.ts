import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect } from "@/lib/mappers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TON_ADDRESS_RE = /^(?:EQ|UQ)[A-Za-z0-9_-]{40,64}$/;
export type ResolvedGiftRow = Record<string, unknown> & {
  asset_id: string;
  virtual_gift_id: string;
  telegram_name: string;
  base_name: string;
  model_name: string;
  backdrop_name: string;
  symbol_name: string;
  model_preview_url: string | null;
};

async function lookup(column: string, value: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("gift_market_overview")
    .select(giftMarketSelect)
    .eq(column, value)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as ResolvedGiftRow) : null;
}

export async function resolveGiftAlias(routeId: string): Promise<ResolvedGiftRow | null> {
  let decoded = routeId;
  try { decoded = decodeURIComponent(routeId); } catch { /* ignored */ }
  const id = decoded.trim();
  if (!id || id.length > 240) return null;

  if (UUID_RE.test(id)) {
    const byVirtual = await lookup("virtual_gift_id", id);
    if (byVirtual) return byVirtual;
    const byAsset = await lookup("asset_id", id);
    if (byAsset) return byAsset;
  }

  const byTelegram = await lookup("telegram_name", id);
  if (byTelegram) return byTelegram;

  if (TON_ADDRESS_RE.test(id)) {
    const byChain = await lookup("chain_nft_address", id);
    if (byChain) return byChain;
  }

  const slug = id.match(/(?:https?:\/\/)?t\.me\/nft\/([A-Za-z0-9_-]{3,180})/i)?.[1];
  return slug ? lookup("telegram_name", slug) : null;
}
