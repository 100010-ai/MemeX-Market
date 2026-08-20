import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { z } from 'zod';
import type { marketActionSchema } from './schema';

type MarketAction = z.infer<typeof marketActionSchema>;
const MARKET_FIELDS = 'id,seller_id,seller_name,car_id,price,vehicle_data,status,buyer_id,created_at,sold_at';

export async function listActiveMarket() {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('market_cars')
    .select(MARKET_FIELDS)
    .eq('status', 'active')
    .order('id', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function getMarketListing(listingId: number) {
  const { data, error } = await createServerSupabase()
    .from('market_cars')
    .select(MARKET_FIELDS)
    .eq('id', listingId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function listPlayerMarket(playerId: string) {
  const { data, error } = await createServerSupabase()
    .from('market_cars')
    .select(MARKET_FIELDS)
    .eq('seller_id', playerId)
    .order('id', { ascending: false })
    .limit(60);
  if (error) throw error;
  return data ?? [];
}

export async function applyMarketAction(playerId: string, body: MarketAction) {
  const supabase = createServerSupabase();
  let rpc = '';
  const args: Record<string, unknown> = { p_player_id: playerId };

  if (body.action === 'list') {
    rpc = 'autosyndicate_server_market_list_v10';
    args.p_price = body.price;
    args.p_vehicle_data = body.vehicle;
  } else if (body.action === 'cancel') {
    rpc = 'autosyndicate_server_market_cancel_v10';
    args.p_listing_id = body.listingId;
  } else if (body.action === 'buy') {
    rpc = 'autosyndicate_server_market_buy_v10';
    args.p_listing_id = body.listingId;
  } else {
    rpc = 'autosyndicate_server_market_settle_v10';
    args.p_listing_id = body.listingId;
  }

  const { data, error } = await supabase.rpc(rpc, args);
  if (error) throw error;
  return data;
}
