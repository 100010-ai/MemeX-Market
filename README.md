# AutoSyndicate Carbon v12.3 — UI Remaster

AutoSyndicate Carbon v12.3 is the production UI remaster of the existing Telegram Mini App. It keeps the v12.2 server/auth foundation while rebuilding the player-facing visual system into a compact Carbon District interface: graphite/carbon surfaces, restrained amber accents, denser cards, mobile-first spacing, lower-cost motion and a larger duel network.


## v12.3 UI remaster

- Player HUD no longer exposes migration, Vercel, cookie, schema or server-debug instructions.
- Carbon District visual system replaces the old pink/neon legacy palette across old components.
- Compact 2-column garage and dealer layout on normal phones, adaptive 1-column layout on narrow devices.
- Reworked profile dashboard, navigation, market, chat, cases, casino, settings and duel cards.
- Duel network displays up to 16 relevant opponents at once.
- 24 additional locally available rivals (64 total when the server content patch is installed).
- `content-visibility`, paint containment, transform/opacity motion and reduced-motion support are used to lower rendering cost in Telegram WebView.
- Chat polling is stopped when leaving the chat screen.
- Telegram session cookie uses production `SameSite=None; Secure`, and bot/env values are normalized before verification.
- Optional server content patch: `supabase/schema_ui_remaster.sql`.

## v12 synchronization fixes

- Server Telegram session is the authoritative online identity.
- Browser Supabase Auth is optional and used only as a realtime accelerator where available.
- A valid HttpOnly session survives Telegram WebView reloads.
- Any Vercel API `401` triggers a one-shot Telegram re-auth and retries the original request automatically.
- `requireSession()` verifies the signed cookie against both `player_profiles` and `telegram_principals`; stale bindings self-repair through re-auth instead of leaving the UI half-online.
- Friends and clans no longer require a separate client Supabase session.
- Chat reads/writes are routed through `/api/social/chat`; direct browser table writes are removed.
- Market reads and mutations use `/api/market`; realtime is optional.
- Case reconciliation uses `/api/cases/pending`.
- Referral operations use `/api/referrals`.
- Bank transfers and claims use `/api/bank`.
- Legacy async PvP transitions use `/api/pvp`.
- Background claims no longer stop when the optional browser Supabase client is unavailable.
- Infrastructure diagnostics remain internal; the commercial player profile does not expose server/schema details.
- `/api/sync/status` reports the deployed synchronization schema version.
- Friends now receive server-enriched profile/presence data.
- Chat messages are resolved to stable `player_id` values rather than identifying the sender by display name.
- Server calls have a client-side timeout so a broken connection does not leave the Telegram UI loading forever.

## v11 systems retained

- Redesigned Street Network duel list.
- 40 original server-managed AI opponents, plus the v12.3 Carbon League expansion.
- Server-managed car catalog.
- `/admin` Control Center with statistics, moderation, balance/car/content controls and audit log.
- Telegram Bot API webhook with secret-token verification and update idempotency.
- `/start`, `/help`, protected `/admin`, and DB-configurable custom commands.
- Chat reply duel flow with Accept/Decline inline buttons.
- Private two-player Mini App duel rooms with membership checks, vehicle selection, ready-check and synchronized `start_at`.

## Stack

- Next.js 16.3.1 App Router
- TypeScript strict mode
- React 19.2.8
- Supabase Auth + PostgreSQL/RLS/RPC
- Telegram Mini Apps + Telegram Bot API webhooks
- Vercel Node.js Functions

## Database migration — use one file

For v12.2 do **not** manually guess which historical migration your database already has. Run this single file in Supabase SQL Editor:

```text
supabase/schema_v12_2_FULL.sql
```

It contains v8 → v12 in the correct order, repairs missing referral/auth/social objects, validates the final schema and is wrapped in one transaction. It is designed for both an old partially-migrated database and a fresh project.

The older `schema_v8.sql` … `schema_v12.sql` files remain in the repository for history/debugging, but normal deployment should use the consolidated installer.

After it succeeds, `game_settings_v11` contains `server.schema_version = 12` and `server.schema_patch = "12.2"`.

See `MIGRATION_V12.md` and `FIX_SERVER_SYNC.md`.

## Environment

Public values may be present in `.env`:

```dotenv
NEXT_PUBLIC_APP_NAME=AutoSyndicate Carbon
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Server secrets belong in Vercel Environment Variables and in local `.env.local` only:

```dotenv
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
TELEGRAM_BOT_TOKEN=123456:BOT_TOKEN
TELEGRAM_BOT_USERNAME=YourBotUsername
TELEGRAM_WEBHOOK_SECRET=generate_a_long_random_secret
SESSION_SECRET=generate_at_least_32_random_characters
ADMIN_TELEGRAM_IDS=123456789,987654321
TELEGRAM_AUTH_MAX_AGE_SECONDS=3600
```

Never put a bot token, service-role key or session secret into `NEXT_PUBLIC_*`.

## Local setup

```bash
cp .env.local.example .env.local
npm install
npm run check:env
npm run typecheck
npm run build
npm run dev
```

`npm run check:env` expects the required variables to be present in the process environment. On Vercel, configure them in Project → Settings → Environment Variables.

## Vercel deployment

1. Apply all required SQL migrations.
2. Configure Production/Preview/Development environment variables in Vercel.
3. Deploy the Next.js project.
4. Open the Mini App from the configured Telegram bot and verify online features load without player-facing infrastructure diagnostics.
5. Open Friends, Clans and Chat. They should work even if the optional browser Supabase realtime session cannot be created.
6. Configure the Telegram webhook from the protected admin flow. See `BOT_SETUP.md`.

## Server synchronization model

```text
Telegram WebApp initData
        ↓ HMAC verification on Vercel
stable tg_<telegram_id> player
        ↓
telegram_principals + player_profiles
        ↓
signed HttpOnly session cookie
        ↓
Next.js /api/* routes
        ↓
service-role queries / server-only RPC bridges
        ↓
Supabase PostgreSQL
```

The browser never chooses another player's server identity. Sensitive API routes derive `playerId` from the verified session cookie.

Browser Supabase Auth may still be created to accelerate realtime UI. Its failure does not invalidate the server session and does not disable Friends, Clans, Chat, Market, Cases, Referrals or Bank APIs.

## Important remaining security debt

The v12 synchronization layer is substantially safer, but the old compatibility runtime still keeps parts of the SYND wallet/inventory/game progression in `localStorage`. Do not treat the current economy as tamper-proof for valuable competitive rewards. The next architectural step is a server-authoritative wallet/inventory/vehicle ledger and server-calculated rewards. See `SECURITY.md`.


### v12.2 session/bootstrap repair

v12.2 fixes a misleading failure mode where database/config errors from `/api/auth/telegram` were returned as HTTP 401 and the client showed “Telegram session unavailable”. Infrastructure failures now have separate error codes, the profile card shows the actual corrective action, and `schema_v12_2_FULL.sql` removes the historical migration-order dependency.


## v12.4 RU FIX

В этой сборке исправлены массовые `400` у `/api/pvp`, `/api/profile/sync`, `/api/sync/status`, `/api/referrals`, `/api/bank`, `/api/social/clans` и других маршрутов, проходивших через старый rate-limit RPC. Также исправлено падение сетки дуэлей `rivalMeta is not defined`, переработано казино, уведомления и русифицирован игровой UI.

Для существующей базы после деплоя выполните `supabase/schema_v12_4_FIX.sql`. Для новой базы используйте обновлённый `supabase/schema_v12_2_FULL.sql`.
