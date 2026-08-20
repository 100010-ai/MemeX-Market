import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const text = async (file) => readFile(path.join(root, file), 'utf8');
const mustExist = async (file) => access(path.join(root, file));
const fail = (message) => { throw new Error(message); };

const runtime = await text('src/legacy/runtime.ts');
if (/\bsb\.(?:from|rpc)\s*\(/.test(runtime)) fail('legacy runtime still performs direct Supabase table/RPC operations');
if (/secure Telegram auth unavailable|Telegram auth unavailable/.test(runtime)) fail('obsolete Telegram auth error path is still present');
for (const marker of [
  'async function serverFetch',
  'async function recoverServerSession',
  'serverSyncPresentationV12',
  "'/api/social/friends'",
  "'/api/social/clans'",
  "'/api/social/chat'",
  "'/api/referrals'",
  "'/api/bank'",
  "'/api/pvp'"
]) {
  if (!runtime.includes(marker)) fail(`missing runtime sync marker: ${marker}`);
}

const authClient = await text('src/features/auth/client.ts');
for (const marker of ['TELEGRAM_INITDATA_MISSING', 'SERVER_UNREACHABLE', '__AUTOSYNDICATE_AUTH_ERROR__']) {
  if (!authClient.includes(marker)) fail(`missing auth diagnostic marker: ${marker}`);
}

const authRoute = await text('src/app/api/auth/telegram/route.ts');
for (const marker of ['SERVER_CONFIG_INVALID', 'TELEGRAM_AUTH_INVALID', 'apiError(error, 500)']) {
  if (!authRoute.includes(marker)) fail(`missing auth route hardening marker: ${marker}`);
}

const schema = await text('supabase/schema_v12.sql');
for (const marker of [
  "'server.schema_version','12'::jsonb",
  'function public.autosyndicate_chat_guard',
  'function public.autosyndicate_server_bind_referrer_v12',
  'function public.autosyndicate_server_bank_send_v12',
  'function public.autosyndicate_server_bank_claim_v12',
  'function public.autosyndicate_server_pvp_action_v12',
  'revoke select on public.player_profiles'
]) {
  if (!schema.includes(marker)) fail(`missing schema_v12 marker: ${marker}`);
}
if ((schema.match(/\$\$/g)?.length ?? 0) % 2 !== 0) fail('unbalanced SQL dollar-quoted blocks');

const fullSchema = await text('supabase/schema_v12_2_FULL.sql');
for (const marker of [
  'INCLUDED: schema_v8.sql',
  'INCLUDED: schema_v9.sql',
  'INCLUDED: schema_v10.sql',
  'INCLUDED: schema_v11.sql',
  'INCLUDED: schema_v12.sql',
  "'server.schema_patch',to_jsonb('12.2'::text)",
  "to_regclass('public.telegram_principals')",
  "to_regclass('public.referrals')"
]) {
  if (!fullSchema.includes(marker)) fail(`missing consolidated migration marker: ${marker}`);
}
if ((fullSchema.match(/^\s*begin;\s*$/gmi)?.length ?? 0) !== 1) fail('consolidated migration must have exactly one BEGIN');
if ((fullSchema.match(/^\s*commit;\s*$/gmi)?.length ?? 0) !== 1) fail('consolidated migration must have exactly one COMMIT');
if ((fullSchema.match(/\$\$/g)?.length ?? 0) % 2 !== 0) fail('unbalanced consolidated SQL dollar-quoted blocks');

for (const route of [
  'src/app/api/session/route.ts',
  'src/app/api/sync/status/route.ts',
  'src/app/api/social/friends/route.ts',
  'src/app/api/social/clans/route.ts',
  'src/app/api/social/chat/route.ts',
  'src/app/api/profile/players/route.ts',
  'src/app/api/cases/pending/route.ts',
  'src/app/api/referrals/route.ts',
  'src/app/api/bank/route.ts',
  'src/app/api/pvp/route.ts',
  'src/app/api/market/route.ts'
]) await mustExist(route);

const publicEnv = await text('.env');
for (const secret of ['SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'SESSION_SECRET', 'ADMIN_TELEGRAM_IDS']) {
  if (publicEnv.includes(`${secret}=`)) fail(`server secret must not be stored in tracked .env: ${secret}`);
}

console.log('AutoSyndicate v12.2 synchronization verification passed.');
