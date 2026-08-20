import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { getServerEnv } from '@/lib/env';
import type { TgMessage, TgUpdate, TgUser } from './types';
import { answerTelegramCallback, sendTelegramMessage } from './telegram';
import { createChatDuelChallenge, handleDuelCallback } from '@/features/duels/server';
import { isAdminTelegramId } from '@/features/admin/auth';
import { enforceRateLimit } from '@/lib/security/rate-limit';

const DEFAULT_DUEL_WORDS = ['дуэль','дуель','поединок','гонка','заезд'];
const fallbackUpdates = new Map<number, number>();

function normalizeText(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9_/@\s-]+/giu, ' ').replace(/\s+/g, ' ').trim();
}

function parseCommand(text: string) {
  const match = text.trim().match(/^\/([a-zA-Z0-9_]{1,32})(?:@[A-Za-z0-9_]{5,64})?(?:\s+([\s\S]*))?$/);
  return match ? { command: match[1].toLowerCase(), args: (match[2] ?? '').trim() } : null;
}

async function isDuelTrigger(text: string) {
  const normalized = normalizeText(text);
  let words = DEFAULT_DUEL_WORDS;
  try {
    const s = createServerSupabase();
    const { data, error } = await s.from('game_settings_v11').select('value').eq('key', 'bot.duel_words').maybeSingle();
    if (!error && Array.isArray(data?.value)) {
      const configured = data.value
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => normalizeText(value)).filter(Boolean);
      if (configured.length) words = [...new Set([...DEFAULT_DUEL_WORDS, ...configured])];
    }
  } catch (error) {
    console.warn('Bot duel words settings unavailable; using defaults', error);
  }
  return words.some((word: string) => normalized === word || normalized.split(' ').includes(word));
}

function fallbackMarkUpdate(updateId: number) {
  const now = Date.now();
  for (const [id, at] of fallbackUpdates) if (now - at > 10 * 60_000) fallbackUpdates.delete(id);
  if (fallbackUpdates.has(updateId)) return false;
  fallbackUpdates.set(updateId, now);
  return true;
}

async function markUpdate(updateId: number) {
  try {
    const s = createServerSupabase();
    const { error } = await s.from('telegram_updates_v11').insert({ update_id: updateId });
    if (!error) return true;
    if (error.code === '23505') return false;
    const msg = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
    if (msg.includes('does not exist') || msg.includes('schema cache') || ['42P01','PGRST205'].includes(String(error.code))) {
      return fallbackMarkUpdate(updateId);
    }
    throw error;
  } catch (error) {
    console.warn('Telegram update ledger unavailable; using process fallback', error);
    return fallbackMarkUpdate(updateId);
  }
}

async function runCommand(message: TgMessage, command: string, args = '') {
  const s = createServerSupabase();
  const { data, error } = await s.from('bot_commands_v11').select('*').eq('command', command).eq('enabled', true).maybeSingle();
  if (error) {
    const msg = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
    if (msg.includes('does not exist') || msg.includes('schema cache') || ['42P01','PGRST205'].includes(String(error.code))) return false;
    throw error;
  }
  if (!data) return false;
  const env = getServerEnv();
  const miniAppUrl = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp`;
  const text = String(data.response_text)
    .replaceAll('{first_name}', message.from?.first_name ?? 'гонщик')
    .replaceAll('{username}', message.from?.username ? `@${message.from.username}` : 'без username')
    .replaceAll('{app_url}', miniAppUrl)
    .replaceAll('{args}', args)
    .replaceAll('{user_id}', String(message.from?.id ?? ''))
    .replaceAll('{chat_id}', String(message.chat.id));
  const keyboard = data.button_label ? [[{ text: String(data.button_label), url: data.button_url || miniAppUrl }]] : undefined;
  await sendTelegramMessage(message.chat.id, text, {
    replyTo: message.message_id,
    parseMode: data.parse_mode === 'MarkdownV2' ? 'MarkdownV2' : data.parse_mode === 'plain' ? undefined : 'HTML',
    keyboard
  });
  return true;
}

async function startReplyDuel(message: TgMessage, target: TgUser) {
  try {
    await enforceRateLimit(`tg_${message.from!.id}`, 'bot-duel-challenge', 4, 60);
    await createChatDuelChallenge(message, target);
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'Не удалось создать дуэль.';
    const text = raw.includes('relation') || raw.includes('schema') || raw.includes('duel_rooms')
      ? 'Дуэли временно недоступны. Попробуйте через минуту.'
      : raw;
    await sendTelegramMessage(message.chat.id, `Не удалось создать дуэль: ${text}`, { replyTo: message.message_id });
  }
}

export async function handleTelegramUpdate(update: TgUpdate) {
  const first = await markUpdate(update.update_id);
  if (!first) return { duplicate: true };

  if (update.callback_query?.data) {
    const handled = await handleDuelCallback(update.callback_query.id, update.callback_query.from, update.callback_query.data, update.callback_query.message);
    if (!handled) await answerTelegramCallback(update.callback_query.id);
    return { callback: true };
  }

  const message = update.message ?? update.edited_message;
  if (!message?.from || message.from.is_bot || !message.text) return { ignored: true };

  const parsed = parseCommand(message.text);
  if (parsed) {
    // /duel works even with Telegram Privacy Mode enabled because commands are delivered to bots.
    if (parsed.command === 'duel') {
      if (!['group','supergroup'].includes(message.chat.type) || !message.reply_to_message?.from) {
        await sendTelegramMessage(message.chat.id, 'Ответьте командой /duel на сообщение игрока, которого хотите вызвать.', { replyTo: message.message_id });
        return { command: 'duel-help' };
      }
      await startReplyDuel(message, message.reply_to_message.from);
      return { command: 'duel' };
    }

    if (parsed.command === 'admin') {
      const env = getServerEnv();
      if (!isAdminTelegramId(message.from.id)) {
        await sendTelegramMessage(message.chat.id, 'У этого Telegram-аккаунта нет доступа к панели управления.', { replyTo: message.message_id });
        return { command: 'admin-denied' };
      }
      await sendTelegramMessage(message.chat.id, '<b>AUTOSYNDICATE CONTROL</b>\n\nПанель управления доступна только администраторам.', { replyTo: message.message_id, parseMode: 'HTML', keyboard: [[{ text: 'Открыть панель', url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=admin` }]] });
      return { command: 'admin' };
    }
    try {
      const handled = await runCommand(message, parsed.command, parsed.args);
      if (!handled && parsed.command === 'start') {
        const env = getServerEnv();
        await sendTelegramMessage(message.chat.id,
          `<b>AUTOSYNDICATE</b>\n\nУличные дуэли, тюнинг, рынок, кланы и турниры. Открой игру и выбери машину.`,
          { replyTo: message.message_id, parseMode: 'HTML', keyboard: [[{ text: 'Открыть AutoSyndicate', url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp` }]] }
        );
      }
      return { command: parsed.command };
    } catch (error) {
      console.error('Bot command failed', { command: parsed.command, error });
      await sendTelegramMessage(message.chat.id, 'Команда временно недоступна.', { replyTo: message.message_id });
      return { command: 'failed' };
    }
  }

  if (message.reply_to_message?.from && ['group','supergroup'].includes(message.chat.type) && await isDuelTrigger(message.text)) {
    await startReplyDuel(message, message.reply_to_message.from);
    return { duel: true };
  }

  return { ignored: true };
}
