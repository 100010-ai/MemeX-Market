# AutoSyndicate v12.2 migration

## Use the consolidated migration

Run exactly this file in **Supabase → SQL Editor**:

```text
supabase/schema_v12_2_FULL.sql
```

Do not run only `schema_v12.sql` on a database whose v8/v9/v10/v11 history is uncertain. v12.2 intentionally ships one consolidated installer because earlier builds could stop halfway through historical migrations and leave objects such as `referrals` or `telegram_principals` missing.

The full installer:

- applies v8 → v12 in the required order;
- uses the fixed SQL-Editor-aware profile guard;
- creates `telegram_principals` and the v10 server bridge;
- creates friends/clans/cases from v9;
- creates admin/bot/duel content tables from v11;
- repairs missing referral tables/functions;
- applies v12 server-only chat/bank/referral/PvP hardening;
- validates critical relations before commit;
- stores `server.schema_version = 12` and `server.schema_patch = "12.2"`.

The migration is wrapped in one transaction. If it fails, fix the reported SQL error and run the whole file again.

## Vercel environment

These variables must exist in the Vercel project for **Production** (and Preview if you use preview deployments):

```text
NEXT_PUBLIC_APP_NAME
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME
TELEGRAM_WEBHOOK_SECRET
SESSION_SECRET
ADMIN_TELEGRAM_IDS
TELEGRAM_AUTH_MAX_AGE_SECONDS
```

Important:

- `TELEGRAM_BOT_TOKEN` must belong to the exact bot that launches this Mini App.
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must point to the same Supabase project where the full SQL was executed.
- `SESSION_SECRET` must be at least 32 characters.
- server secrets must never use the `NEXT_PUBLIC_` prefix.

After changing Vercel Environment Variables, redeploy. Existing deployments do not magically receive a new build-time public environment.

## Smoke test

Open the app from the Telegram bot and check:

1. Profile shows `СЕРВЕР ПОДКЛЮЧЕН`.
2. `/api/session` returns an authenticated session inside the Mini App.
3. Friends loads.
4. Clans loads.
5. Global chat loads and can send.
6. Market loads.
7. Case pending reconciliation loads.
8. `/api/sync/status` returns `schemaVersion: 12`.

## Meaning of the new profile errors

- `БАЗА НЕ ГОТОВА` → run `supabase/schema_v12_2_FULL.sql`.
- `VERCEL ENV НЕ НАСТРОЕНЫ` → configure Vercel Environment Variables and redeploy.
- `НЕТ TELEGRAM-СЕССИИ` → open the Mini App from the Telegram bot, not as a plain browser URL.
- `TELEGRAM-АВТОРИЗАЦИЯ ОТКЛОНЕНА` → bot token mismatch, expired/invalid initData, or wrong bot launching the app.
- `СЕРВЕР НЕДОСТУПЕН` → inspect Vercel deployment/runtime logs.
