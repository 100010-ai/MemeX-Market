const required = ['NEXT_PUBLIC_APP_URL','TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET'];
for (const key of required) {
  if (!process.env[key]?.trim()) {
    console.error(`Missing ${key}. Run with Vercel envs or export it first.`);
    process.exit(1);
  }
}
const appUrl = process.env.NEXT_PUBLIC_APP_URL.trim().replace(/\/$/, '');
const token = process.env.TELEGRAM_BOT_TOKEN.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET.trim();
const api = async (method, body = {}) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(`${method}: ${j.description || r.status}`);
  return j.result;
};
const me = await api('getMe');
await api('setWebhook', {
  url: `${appUrl}/api/telegram/webhook`,
  secret_token: secret,
  allowed_updates: ['message','edited_message','callback_query','my_chat_member'],
  drop_pending_updates: false,
  max_connections: 40
});
await api('setMyCommands', { commands: [
  {command:'start',description:'Открыть AutoSyndicate'},
  {command:'help',description:'Помощь'},
  {command:'duel',description:'Вызвать игрока ответом на сообщение'}
]});
const info = await api('getWebhookInfo');
console.log(JSON.stringify({
  bot: me.username,
  webhook: info.url,
  pending: info.pending_update_count,
  lastError: info.last_error_message || null,
  privacyModeDisabled: me.can_read_all_group_messages === true,
  plainDuelWords: me.can_read_all_group_messages === true ? 'enabled' : 'requires BotFather /setprivacy -> Disable',
  commandFallback: '/duel works in Privacy Mode'
}, null, 2));
