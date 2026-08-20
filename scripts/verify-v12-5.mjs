import fs from 'node:fs';
const files = [
  'src/features/bot/handler.ts','src/features/bot/telegram.ts','src/lib/security/rate-limit.ts','supabase/schema_v12_5_FIX.sql'
];
for (const f of files) if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
const bot = fs.readFileSync('src/features/bot/handler.ts','utf8');
if (!bot.includes("parsed.command === 'duel'")) throw new Error('/duel fallback missing');
if (!bot.includes('DEFAULT_DUEL_WORDS')) throw new Error('duel words missing');
console.log('v12.5 Telegram duel checks: OK');
