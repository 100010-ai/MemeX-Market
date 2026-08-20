import 'server-only';
import { getServerEnv } from '@/lib/env';

interface InlineButton { text: string; callback_data?: string; url?: string; }
interface BotInfo {
  id: number;
  username?: string;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}
interface WebhookInfo {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}

async function telegramCall<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = getServerEnv().TELEGRAM_BOT_TOKEN.trim();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store'
  });
  const json = await response.json() as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !json.ok) throw new Error(json.description ?? `Telegram ${method} failed`);
  return json.result as T;
}

export function sendTelegramMessage(chatId: number, text: string, options?: { replyTo?: number; parseMode?: 'HTML'|'MarkdownV2'; keyboard?: InlineButton[][] }) {
  return telegramCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: options?.parseMode,
    reply_parameters: options?.replyTo ? { message_id: options.replyTo, allow_sending_without_reply: true } : undefined,
    reply_markup: options?.keyboard ? { inline_keyboard: options.keyboard } : undefined,
    disable_web_page_preview: true
  });
}

export function editTelegramMessage(chatId: number, messageId: number, text: string, keyboard?: InlineButton[][]) {
  return telegramCall('editMessageText', {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    disable_web_page_preview: true
  });
}

export function answerTelegramCallback(callbackQueryId: string, text?: string, showAlert = false) {
  return telegramCall('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert });
}

export function getTelegramBotInfo() {
  return telegramCall<BotInfo>('getMe');
}

export function getTelegramWebhookInfo() {
  return telegramCall<WebhookInfo>('getWebhookInfo');
}

export async function setTelegramWebhook() {
  const env = getServerEnv();
  const result = await telegramCall('setWebhook', {
    url: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/telegram/webhook`,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message','edited_message','callback_query','my_chat_member'],
    drop_pending_updates: false,
    max_connections: 40
  });
  await telegramCall('setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть AutoSyndicate' },
      { command: 'help', description: 'Помощь и команды' },
      { command: 'duel', description: 'Вызвать игрока на дуэль ответом' }
    ]
  });
  return result;
}

let lastWebhookEnsureAt = 0;
let lastWebhookDiagnostics: { privacyModeDisabled: boolean; username: string; webhookUrl: string } | null = null;

/**
 * Keeps the production webhook repaired automatically when the Mini App is opened.
 * Telegram Privacy Mode cannot be changed through Bot API; can_read_all_group_messages
 * tells us whether plain words like "дуэль" will reach the bot in groups.
 */
export async function ensureTelegramWebhook(force = false) {
  const now = Date.now();
  if (!force && lastWebhookDiagnostics && now - lastWebhookEnsureAt < 5 * 60_000) return lastWebhookDiagnostics;

  const env = getServerEnv();
  const expectedUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/telegram/webhook`;
  const [bot, info] = await Promise.all([getTelegramBotInfo(), getTelegramWebhookInfo()]);
  const allowed = new Set(info.allowed_updates ?? []);
  const webhookOk = info.url === expectedUrl && allowed.has('message') && allowed.has('callback_query');
  if (!webhookOk) await setTelegramWebhook();

  lastWebhookEnsureAt = now;
  lastWebhookDiagnostics = {
    privacyModeDisabled: bot.can_read_all_group_messages === true,
    username: bot.username ?? env.TELEGRAM_BOT_USERNAME,
    webhookUrl: expectedUrl
  };
  if (!lastWebhookDiagnostics.privacyModeDisabled) {
    console.warn('Telegram Privacy Mode is enabled: plain group words such as "дуэль" are not delivered. /duel reply still works. Disable Privacy Mode in BotFather to receive plain duel words.');
  }
  return lastWebhookDiagnostics;
}
