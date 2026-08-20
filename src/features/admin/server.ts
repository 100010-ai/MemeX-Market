import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { GameSession } from '@/lib/security/session';
import type { z } from 'zod';
import { adminCarSchema, adminOpponentSchema, botCommandSchema, gameSettingSchema, playerAdminActionSchema } from './schema';

type PlayerAction = z.infer<typeof playerAdminActionSchema>;
type AdminCar = z.infer<typeof adminCarSchema>;
type AdminOpponent = z.infer<typeof adminOpponentSchema>;
type BotCommand = z.infer<typeof botCommandSchema>;
type GameSetting = z.infer<typeof gameSettingSchema>;

async function audit(admin: GameSession, action: string, targetType: string, targetId: string | null, payload: unknown) {
  const supabase = createServerSupabase();
  await supabase.from('admin_audit_log_v11').insert({
    admin_player_id: admin.playerId,
    admin_telegram_id: admin.telegramId,
    action,
    target_type: targetType,
    target_id: targetId,
    payload
  });
}

export async function getAdminStats() {
  const s = createServerSupabase();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since15m = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const [players, active15m, races, races24h, raceRows24h, market, clans, cases, duels, banned, balances, topBalance, topRating, topEarned, recentRaces, duelRows, botUpdates, auditRows, telegramProfiles, principals, syncSettings] = await Promise.all([
    s.from('player_profiles').select('*', { count: 'exact', head: true }),
    s.from('player_profiles').select('*', { count: 'exact', head: true }).gte('last_seen', since15m),
    s.from('race_results_v10').select('*', { count: 'exact', head: true }),
    s.from('race_results_v10').select('*', { count: 'exact', head: true }).gte('created_at', since24h),
    s.from('race_results_v10').select('elapsed_ms,verified,won,top_speed_kmh').gte('created_at', since24h).limit(5000),
    s.from('market_cars').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    s.from('clans').select('*', { count: 'exact', head: true }),
    s.from('case_rolls').select('*', { count: 'exact', head: true }),
    s.from('duel_rooms_v11').select('*', { count: 'exact', head: true }).in('status', ['pending','accepted','ready','racing']),
    s.from('player_profiles').select('*', { count: 'exact', head: true }).not('banned_at', 'is', null),
    s.from('player_profiles').select('balance,total_earned,races,wins,rating').order('balance', { ascending: false }).limit(5000),
    s.from('player_profiles').select('id,name,telegram_username,balance,level,rating').order('balance', { ascending: false }).limit(10),
    s.from('player_profiles').select('id,name,telegram_username,balance,level,rating').order('rating', { ascending: false }).limit(10),
    s.from('player_profiles').select('id,name,telegram_username,total_earned,level,rating').order('total_earned', { ascending: false }).limit(10),
    s.from('race_results_v10').select('id,player_id,opponent_id,route,won,elapsed_ms,top_speed_kmh,verified,created_at').order('created_at', { ascending: false }).limit(20),
    s.from('duel_rooms_v11').select('status,created_at').gte('created_at', since24h).limit(1000),
    s.from('telegram_updates_v11').select('*', { count: 'exact', head: true }).gte('processed_at', since24h),
    s.from('admin_audit_log_v11').select('admin_player_id,action,target_type,target_id,created_at').order('created_at', { ascending: false }).limit(20),
    s.from('player_profiles').select('*', { count: 'exact', head: true }).like('id', 'tg_%'),
    s.from('telegram_principals').select('*', { count: 'exact', head: true }),
    s.from('game_settings_v11').select('key,value').in('key', ['server.schema_version','server.sync_mode'])
  ]);
  const rows = (balances.data ?? []) as Array<{ balance?: number | string | null; total_earned?: number | string | null; races?: number | null; wins?: number | null }>;
  const duelRowsTyped = (duelRows.data ?? []) as Array<{ status?: string | null }>;
  const races24Typed = (raceRows24h.data ?? []) as Array<{ elapsed_ms?: number | string | null; verified?: boolean | null; won?: boolean | null; top_speed_kmh?: number | string | null }>;
  const totalBalance = rows.reduce((sum: number, row) => sum + Number(row.balance ?? 0), 0);
  const totalEarned = rows.reduce((sum: number, row) => sum + Number(row.total_earned ?? 0), 0);
  const totalRaces = rows.reduce((sum: number, row) => sum + Number(row.races ?? 0), 0);
  const totalWins = rows.reduce((sum: number, row) => sum + Number(row.wins ?? 0), 0);
  const averageBalance = rows.length ? Math.round(totalBalance / rows.length) : 0;
  const averageRating = rows.length ? Math.round(rows.reduce((sum: number, row: any) => sum + Number(row.rating ?? 0), 0) / rows.length) : 0;
  const averageRaceMs24h = races24Typed.length ? Math.round(races24Typed.reduce((sum: number, row) => sum + Number(row.elapsed_ms ?? 0), 0) / races24Typed.length) : 0;
  const verifiedRaces24h = races24Typed.filter((row) => row.verified === true).length;
  const verifiedRate24h = races24Typed.length ? Math.round((verifiedRaces24h / races24Typed.length) * 1000) / 10 : 0;
  const avgTopSpeed24h = races24Typed.length ? Math.round(races24Typed.reduce((sum: number, row) => sum + Number(row.top_speed_kmh ?? 0), 0) / races24Typed.length) : 0;
  const duelStatus24h = duelRowsTyped.reduce<Record<string, number>>((acc: Record<string, number>, row) => {
    acc[String(row.status)] = (acc[String(row.status)] ?? 0) + 1;
    return acc;
  }, {});
  const syncMap = Object.fromEntries(((syncSettings.data ?? []) as Array<{ key: string; value: unknown }>).map((row) => [row.key, row.value]));
  const telegramProfileCount = telegramProfiles.count ?? 0;
  const principalCount = principals.count ?? 0;
  return {
    players: players.count ?? 0,
    activePlayers15m: active15m.count ?? 0,
    races: races.count ?? 0,
    races24h: races24h.count ?? 0,
    activeListings: market.count ?? 0,
    clans: clans.count ?? 0,
    caseRolls: cases.count ?? 0,
    activeDuels: duels.count ?? 0,
    bannedPlayers: banned.count ?? 0,
    botUpdates24h: botUpdates.count ?? 0,
    serverSchemaVersion: Number(syncMap['server.schema_version'] ?? 0),
    syncMode: String(syncMap['server.sync_mode'] ?? ''),
    telegramProfiles: telegramProfileCount,
    telegramPrincipals: principalCount,
    principalCoverage: telegramProfileCount ? Math.round((Math.min(principalCount, telegramProfileCount) / telegramProfileCount) * 1000) / 10 : 100,
    totalBalance,
    totalEarned,
    averageBalance,
    averageRating,
    averageRaceMs24h,
    verifiedRaces24h,
    verifiedRate24h,
    avgTopSpeed24h,
    totalRaces,
    globalWinRate: totalRaces ? Math.round((totalWins / totalRaces) * 1000) / 10 : 0,
    duelStatus24h,
    topBalance: topBalance.data ?? [],
    topRating: topRating.data ?? [],
    topEarned: topEarned.data ?? [],
    recentRaces: recentRaces.data ?? [],
    recentAudit: auditRows.data ?? []
  };
}

export async function listAdminPlayers(query = '') {
  const s = createServerSupabase();
  let request = s.from('player_profiles').select('id,name,telegram_username,level,balance,races,wins,losses,rating,current_car_name,last_seen,banned_at,ban_reason,owned_cars').order('last_seen', { ascending: false }).limit(200);
  const q = query.trim().replace(/[^A-Za-zА-Яа-яЁё0-9@._ -]/g, '').slice(0, 64);
  if (q) request = request.or(`id.ilike.%${q}%,name.ilike.%${q}%,telegram_username.ilike.%${q}%`);
  const { data, error } = await request;
  if (error) throw error;
  return data ?? [];
}

export async function applyPlayerAdminAction(admin: GameSession, action: PlayerAction) {
  const s = createServerSupabase();
  const { data, error } = await s.rpc('autosyndicate_admin_player_action_v11', {
    p_admin_player_id: admin.playerId,
    p_player_id: action.playerId,
    p_action: action.action,
    p_payload: action
  });
  if (error) throw error;
  await audit(admin, `player.${action.action}`, 'player', action.playerId, action);
  return data;
}

export async function listCars() {
  const { data, error } = await createServerSupabase().from('game_cars_v11').select('*').order('sort_order').order('id');
  if (error) throw error;
  return data ?? [];
}

export async function upsertCar(admin: GameSession, car: AdminCar) {
  const row = {
    id: car.id, name: car.name, image_path: car.imagePath ?? null, price: car.price, power: car.power,
    tier: car.tier, category: car.category, flavor: car.flavor, active: car.active, sort_order: car.sortOrder,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await createServerSupabase().from('game_cars_v11').upsert(row).select().single();
  if (error) throw error;
  await audit(admin, 'content.car.upsert', 'car', String(car.id), car);
  return data;
}

export async function listOpponents() {
  const { data, error } = await createServerSupabase().from('game_opponents_v11').select('*').order('sort_order').order('key');
  if (error) throw error;
  return data ?? [];
}

export async function upsertOpponent(admin: GameSession, opp: AdminOpponent) {
  const row = {
    key: opp.key, name: opp.name, power: opp.power, reward: opp.reward, unlock_level: opp.unlockLevel,
    car_name: opp.carName, rating: opp.rating, style: opp.style, favorite_tracks: opp.favoriteTracks,
    wins: opp.wins, losses: opp.losses, avatar: opp.avatar, taunt: opp.taunt, pre_lines: opp.preLines,
    win_line: opp.winLine, lose_line: opp.loseLine, boss: opp.boss, active: opp.active, sort_order: opp.sortOrder,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await createServerSupabase().from('game_opponents_v11').upsert(row, { onConflict: 'key' }).select().single();
  if (error) throw error;
  await audit(admin, 'content.opponent.upsert', 'opponent', opp.key, opp);
  return data;
}

export async function listBotCommands() {
  const { data, error } = await createServerSupabase().from('bot_commands_v11').select('*').order('command');
  if (error) throw error;
  return data ?? [];
}

export async function upsertBotCommand(admin: GameSession, command: BotCommand) {
  const row = {
    command: command.command, response_text: command.responseText, enabled: command.enabled,
    parse_mode: command.parseMode, button_label: command.buttonLabel ?? null, button_url: command.buttonUrl ?? null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await createServerSupabase().from('bot_commands_v11').upsert(row, { onConflict: 'command' }).select().single();
  if (error) throw error;
  await audit(admin, 'bot.command.upsert', 'bot_command', command.command, command);
  return data;
}

export async function deleteBotCommand(admin: GameSession, command: string) {
  if (command === 'start') throw new Error('system /start cannot be deleted');
  const { error } = await createServerSupabase().from('bot_commands_v11').delete().eq('command', command);
  if (error) throw error;
  await audit(admin, 'bot.command.delete', 'bot_command', command, {});
}

export async function listGameSettings() {
  const { data, error } = await createServerSupabase().from('game_settings_v11').select('*').order('key');
  if (error) throw error;
  return data ?? [];
}

export async function upsertGameSetting(admin: GameSession, setting: GameSetting) {
  const { data, error } = await createServerSupabase().from('game_settings_v11').upsert({ key: setting.key, value: setting.value, updated_at: new Date().toISOString() }).select().single();
  if (error) throw error;
  await audit(admin, 'settings.upsert', 'setting', setting.key, setting.value);
  return data;
}
