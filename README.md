# MemeX Market (MXM) v0.8.1

Telegram Mini App for a multiplayer simulated market built with Next.js, TypeScript, Supabase/Postgres and Vercel.

## v0.8.1

- Virtual TON is the in-game denomination.
- Removed the MTProto/user-session runtime dependency and `@mtcute/node`.
- Telegram Gift catalogue sources are configured in local `/control` and imported through the existing Telegram Bot API token.
- Offline NPC liquidity uses only verified real Telegram Unique Gift metadata already stored in `gift_assets`.
- NPC system accounts are excluded from leaderboards and are not represented as real human players.
- NPC listing prices are derived from real Gift traits and existing MXM collection observations. A small, auditable `rare_deal` probability can list a genuinely rare Gift below its calculated virtual fair value.
- Market opening never waits for an external Telegram catalogue scan. NPC liquidity is generated from Supabase in a bounded DB-only tick.
- Local God Mode no longer needs `MXM_LOCAL_ADMIN_ENABLED` or `MXM_LOCAL_ADMIN_TOKEN`. On first local `/control` open, a random key is generated into `.mxm-control-secret` and printed in the terminal.
- Fixed React hydration warning caused by Telegram modifying root viewport CSS before hydration.
- Added a matching `pnpm-lock.yaml`; Vercel frozen-lockfile installs no longer fail because of `@mtcute/node`.
- Added `.gitignore` for `.env*`, `.mxm-control-secret`, `.next`, `node_modules`, etc.

## Database upgrade

If your database already has migration `008_v08_global_resale_virtual_ton.sql`, run only:

```text
supabase/migrations/009_v081_npc_liquidity.sql
```

The migration converts legacy `telegram_resale` catalogue rows to `bot_catalog` and keeps existing real Gift metadata.

## Environment

Copy `.env.example` to `.env.local` locally or configure the same production values in Vercel.

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
TELEGRAM_BOT_TOKEN=123456789:AA...
SESSION_SECRET=your-own-random-secret-at-least-32-characters
ADMIN_TELEGRAM_IDS=123456789
```

There are no `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_USER_SESSION`, `MARKET_CATALOG_*` or `MARKET_BOOTSTRAP_*` variables in v0.8.1.

## Local God Mode

Run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000/control
```

On the first request, MXM creates `.mxm-control-secret` in the project root and prints the key to the terminal. Paste that key into the login form. The file is ignored by Git.

The control panel can:

- adjust/set player balances and XP;
- ban/unban players and hide them from leaderboards;
- create/edit/delete missions;
- create, hide, stop or delete meme coins and upload coin images;
- add Telegram numeric IDs as catalogue sources;
- synchronize real Unique Gift metadata from those sources through Bot API;
- run the offline NPC liquidity tick;
- transfer/list virtual Gifts;
- inspect the audit log and NPC pricing state.

## NPC Gift liquidity

NPCs do not invent NFT metadata. The flow is:

```text
Telegram Bot API source
        ↓
verified Unique Gift metadata
        ↓
gift_assets (catalog_source=bot_catalog)
        ↓
offline NPC liquidity engine
        ↓
virtual_gifts / virtual TON listings
        ↓
player secondary market
```

The market tick targets a small inventory instead of displaying every catalogue asset. It runs only when liquidity is low and is protected by a Postgres lock/cooldown.

A listing fair value is derived from model/symbol/backdrop rarity, special Gift number characteristics, and existing MXM collection floor/last-sale observations when available. A rare asset has a small deterministic chance to enter `rare_deal` mode and be listed at a meaningful discount. These decisions are stored in `npc_market_log` for audit.

If no real catalogue assets have ever been imported, MXM shows an empty state rather than creating fake Gifts. Before public launch, add one or more catalogue source Telegram IDs in local `/control` and run catalogue sync once.

## Install / build

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

The main authenticated app must be opened from Telegram because Telegram `initData` is verified by the server.
