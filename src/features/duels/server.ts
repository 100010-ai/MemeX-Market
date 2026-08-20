import 'server-only';
import { randomBytes } from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { getServerEnv } from '@/lib/env';
import type { GameSession } from '@/lib/security/session';
import type { TgMessage, TgUser } from '@/features/bot/types';
import { editTelegramMessage, sendTelegramMessage, answerTelegramCallback } from '@/features/bot/telegram';

function displayName(user: TgUser) {
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || String(user.id);
}
function safeHtml(value: string) { return value.replace(/[&<>]/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]!)); }
function makeCode() { return randomBytes(12).toString('base64url'); }
function playerIdFromTelegram(id: number) { return `tg_${id}`; }

export async function createChatDuelChallenge(message: TgMessage, target: TgUser) {
  if (!message.from) throw new Error('sender missing');
  if (target.is_bot) throw new Error('bot cannot duel');
  if (message.from.id === target.id) throw new Error('cannot duel yourself');
  const s = createServerSupabase();
  const code = makeCode();
  const { data, error } = await s.from('duel_rooms_v11').insert({
    public_code: code,
    chat_id: message.chat.id,
    challenge_message_id: message.message_id,
    player_a_id: playerIdFromTelegram(message.from.id),
    player_b_id: playerIdFromTelegram(target.id),
    player_a_telegram_id: message.from.id,
    player_b_telegram_id: target.id,
    player_a_name: displayName(message.from),
    player_b_name: displayName(target),
    status: 'pending',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
  }).select('*').single();
  if (error) throw error;
  const sent = await sendTelegramMessage(message.chat.id,
    `<b>${safeHtml(displayName(message.from))}</b> вызывает <b>${safeHtml(displayName(target))}</b> на дуэль.\n\nВызов действует 10 минут. Принять может только вызванный игрок.`,
    { replyTo: message.message_id, parseMode: 'HTML', keyboard: [[
      { text: 'Принять дуэль', callback_data: `duel_accept:${code}` },
      { text: 'Отклонить', callback_data: `duel_decline:${code}` }
    ]] }
  ) as { message_id?: number };
  if (sent?.message_id) await s.from('duel_rooms_v11').update({ bot_message_id: sent.message_id }).eq('id', data.id);
  return data;
}

export async function handleDuelCallback(callbackId: string, actor: TgUser, data: string, message?: TgMessage) {
  const [action, code] = data.split(':');
  if (!code || !['duel_accept','duel_decline'].includes(action)) return false;
  const s = createServerSupabase();
  const { data: room, error } = await s.from('duel_rooms_v11').select('*').eq('public_code', code).maybeSingle();
  if (error) throw error;
  if (!room) { await answerTelegramCallback(callbackId, 'Дуэль не найдена.', true); return true; }
  if (Number(room.player_b_telegram_id) !== actor.id) { await answerTelegramCallback(callbackId, 'Этот вызов адресован другому игроку.', true); return true; }
  if (room.status !== 'pending' || new Date(room.expires_at).getTime() < Date.now()) { await answerTelegramCallback(callbackId, 'Вызов уже недоступен.', true); return true; }
  if (action === 'duel_decline') {
    await s.from('duel_rooms_v11').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', room.id).eq('status', 'pending');
    await answerTelegramCallback(callbackId, 'Дуэль отклонена.');
    if (message) await editTelegramMessage(message.chat.id, message.message_id, `<b>${safeHtml(room.player_b_name)}</b> отклонил дуэль.`);
    return true;
  }
  const { data: accepted, error: acceptError } = await s.from('duel_rooms_v11').update({ status: 'accepted', accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', room.id).eq('status','pending').select('*').single();
  if (acceptError) throw acceptError;
  const env = getServerEnv();
  const url = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=duel_${accepted.public_code}`;
  await answerTelegramCallback(callbackId, 'Дуэль принята.');
  if (message) await editTelegramMessage(message.chat.id, message.message_id,
    `<b>${safeHtml(accepted.player_b_name)}</b> принял вызов <b>${safeHtml(accepted.player_a_name)}</b>.\n\nОба игрока должны открыть приватную комнату, выбрать машину и подтвердить готовность.`,
    [[{ text: 'Открыть комнату дуэли', url }]]
  );
  return true;
}

export async function getDuelRoomForSession(session: GameSession, code: string) {
  const s = createServerSupabase();
  const { data: room, error } = await s.from('duel_rooms_v11').select('*').eq('public_code', code).maybeSingle();
  if (error) throw error;
  if (!room) throw new Error('duel room not found');
  if (![room.player_a_id, room.player_b_id].includes(session.playerId)) throw new Error('FORBIDDEN');
  if (room.status === 'pending') throw new Error('duel not accepted');
  const ids = [room.player_a_id, room.player_b_id];
  const { data: profiles, error: profileError } = await s.from('player_profiles').select('id,name,photo_url,level,rating,current_car_name,owned_cars,banned_at').in('id', ids);
  if (profileError) throw profileError;
  const me = profiles?.find((p: any) => p.id === session.playerId);
  if (!me) throw new Error('profile missing');
  if (me.banned_at) throw new Error('player banned');
  const owned = Array.isArray(me.owned_cars) ? me.owned_cars : [];
  const { data: cars, error: carError } = await s.from('game_cars_v11').select('id,name,image_path,power,tier,category').in('id', owned.length ? owned : [1]).eq('active', true).order('power');
  if (carError) throw carError;
  const selectedIds = [room.player_a_car_id, room.player_b_car_id].filter((id): id is number => Number.isInteger(id));
  let selectedCars: Array<{ id:number; name:string; image_path:string|null; power:number; tier:string; category:string }> = [];
  if (selectedIds.length) {
    const selected = await s.from('game_cars_v11').select('id,name,image_path,power,tier,category').in('id', selectedIds);
    if (selected.error) throw selected.error;
    selectedCars = selected.data ?? [];
  }
  return { room, profiles: profiles ?? [], cars: cars ?? [], selectedCars, role: room.player_a_id === session.playerId ? 'a' : 'b' };
}

export async function updateDuelRoom(session: GameSession, action: { action: string; code: string; carId?: number; ready?: boolean; elapsedMs?: number; topSpeedKmh?: number; perfectShifts?: number; missedShifts?: number }) {
  const s = createServerSupabase();
  const current = await getDuelRoomForSession(session, action.code);
  const room = current.room;
  const side = current.role;
  if (['finished','declined','cancelled','expired'].includes(room.status)) throw new Error('duel closed');
  if (action.action === 'selectCar') {
    if (!current.cars.some((car: any) => car.id === action.carId)) throw new Error('car not owned');
    const patch = side === 'a' ? { player_a_car_id: action.carId, player_a_ready: false } : { player_b_car_id: action.carId, player_b_ready: false };
    const { error } = await s.from('duel_rooms_v11').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', room.id);
    if (error) throw error;
  } else if (action.action === 'ready') {
    const carId = side === 'a' ? room.player_a_car_id : room.player_b_car_id;
    if (!carId) throw new Error('select car first');
    const patch = side === 'a' ? { player_a_ready: Boolean(action.ready) } : { player_b_ready: Boolean(action.ready) };
    const { data: updated, error } = await s.from('duel_rooms_v11').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', room.id).select('*').single();
    if (error) throw error;
    if (updated.player_a_ready && updated.player_b_ready && ['accepted','ready'].includes(updated.status)) {
      const startAt = new Date(Date.now() + 5000).toISOString();
      const { data: started, error: startError } = await s.from('duel_rooms_v11').update({ status: 'racing', start_at: startAt, updated_at: new Date().toISOString() }).eq('id', room.id).in('status', ['accepted','ready']).select('*').maybeSingle();
      if (startError) throw startError;
      if (started?.chat_id) {
        void sendTelegramMessage(Number(started.chat_id), `<b>ДУЭЛЬ НАЧАЛАСЬ</b>\n\n${safeHtml(started.player_a_name)}  VS  ${safeHtml(started.player_b_name)}\nОба игрока выбрали машины. Синхронный старт через 5 секунд.`, { parseMode: 'HTML' });
      }
    } else {
      await s.from('duel_rooms_v11').update({ status: 'ready' }).eq('id', room.id).eq('status', 'accepted');
    }
  } else if (action.action === 'submitResult') {
    if (room.status !== 'racing') throw new Error('duel is not racing');
    const result = {
      elapsedMs: Math.trunc(action.elapsedMs ?? 0), topSpeedKmh: Number(action.topSpeedKmh ?? 0),
      perfectShifts: Math.trunc(action.perfectShifts ?? 0), missedShifts: Math.trunc(action.missedShifts ?? 0), submittedAt: new Date().toISOString()
    };
    if (result.elapsedMs < 8000 || result.elapsedMs > 180000 || result.topSpeedKmh < 0 || result.topSpeedKmh > 381) throw new Error('invalid result');
    const patch = side === 'a' ? { player_a_result: result } : { player_b_result: result };
    const resultColumn = side === 'a' ? 'player_a_result' : 'player_b_result';
    const { data: updated, error } = await s.from('duel_rooms_v11').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', room.id).eq('status', 'racing').is(resultColumn, null).select('*').maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error('result already submitted');
    if (updated.player_a_result && updated.player_b_result) {
      const aMs = Number(updated.player_a_result.elapsedMs), bMs = Number(updated.player_b_result.elapsedMs);
      const winner = aMs === bMs ? 'draw' : aMs < bMs ? updated.player_a_id : updated.player_b_id;
      await s.from('duel_rooms_v11').update({ status: 'finished', winner_player_id: winner === 'draw' ? null : winner, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', room.id).eq('status','racing');
      if (updated.chat_id && updated.bot_message_id) {
        const resultText = aMs === bMs ? 'Ничья.' : `<b>${safeHtml(aMs < bMs ? updated.player_a_name : updated.player_b_name)}</b> выигрывает дуэль.`;
        void sendTelegramMessage(Number(updated.chat_id), `${resultText}\n\n${safeHtml(updated.player_a_name)} — ${(aMs/1000).toFixed(3)} c\n${safeHtml(updated.player_b_name)} — ${(bMs/1000).toFixed(3)} c`, { parseMode: 'HTML' });
      }
    }
  }
  return getDuelRoomForSession(session, action.code);
}
