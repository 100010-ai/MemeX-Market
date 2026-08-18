# MemeX Market (MXM) v0.6.0

Telegram Mini App for a multiplayer simulated market built with **Next.js, TypeScript, Tailwind CSS, Supabase and Vercel**.

MXM has two connected markets:

- **Coins** — player-created meme coins with server-side AMM trading, positions, OHLC candles, volume, holders and market cap.
- **Gifts** — MXM ownership/trading around exact metadata and media synced from Telegram Unique Gifts. The collectible in Telegram is never transferred by MXM.

A new profile starts with **$100 MXM cash**. There are no seeded market assets, generated Gift media, synthetic listings, browser dev accounts or demo prices.

## v0.6 — Exchange & Retention

- Persistent **watchlist** for meme coins and Telegram Gift collections.
- Dedicated Gift collection pages with floor, 24h volume, holders, sales candles, trait floors and live listings.
- Coin market sorting for Trending, Gainers, Volume, Market Cap and New.
- Server-derived AMM quote preview before every coin trade: output, execution price, 0.5% fee, price impact and projected post-trade price.
- Richer coin metrics from actual reserves/trades: liquidity, ATH, all-time volume and 24h buy/sell flow.
- Persistent XP/level progression driven by completed trades, coin launches and claimed missions.
- Historical XP backfill is deterministic from existing MXM activity.
- Profile, Tasks and desktop shell expose level/XP progress.
- Route error boundary with the exact application error instead of a blank render.
- `/api/health` reports the correct v0.6 version.
- Still **no seeded assets, fake Gift media, generated prices, dev login or market-data fallbacks**.

## v0.5 — Real Market Core

- Strict Telegram Gift sync with a persisted diagnostics run for every attempt.
- Gift sync validates Telegram identity, number, model, symbol, backdrop, rarity, sticker identity, dimensions and media kind before upsert.
- Model + symbol media are rendered from Telegram file IDs; backdrop colors come from Telegram metadata.
- Burned Gifts are made non-tradeable and any open listing/offers are closed.
- Gift collection candles are rebuilt from completed MXM Gift sales and then maintained at one-minute OHLC resolution.
- Gift market cards expose live offer depth and use only actual listings/market observations.
- Pending Gift offers reserve MXM cash. Coin buys, coin launches, Gift buys and new offers can spend only the remaining available balance.
- Gift RPCs reject burned assets and keep ownership/balance changes transactional.
- Gift detail UI now includes collection/model/backdrop/symbol floors, offers, activity and price history.
- Market UI is denser and closer to a Telegram-native marketplace: compact filters, sorting, Gift grid, collection stats and live feed.
- Leaderboard now has Overall, total realized PnL, Gift PnL, Coin PnL, collection value and creator market-cap boards.
- Vault/Profile expose available vs reserved balance and detailed Telegram Gift sync results.
- Gift offer changes publish a public-safe `market_events` invalidation while private `gift_offers` rows stay server-only.
- Added private `/admin` diagnostics for Telegram Gift source health and sync failures.
- Added more event-driven daily/weekly Gift missions.

## Upgrading an existing MXM database

### From v0.5

Run only:

```text
supabase/migrations/004_v06_exchange_retention.sql
```

### From v0.4.1

Run, in order:

```text
supabase/migrations/003_v05_real_market_core.sql
supabase/migrations/004_v06_exchange_retention.sql
```

### From the old v0.2 schema

Run, in order:

```text
supabase/migrations/002_remove_legacy_placeholders.sql
supabase/migrations/003_v05_real_market_core.sql
supabase/migrations/004_v06_exchange_retention.sql
```

If an old attempt at `002_remove_legacy_placeholders.sql` failed on a dependent view, use the corrected `002` included here and run it from the beginning. Its transaction rolls back a failed attempt instead of leaving a half-migrated schema.

### Fresh Supabase project

Run all migrations in order:

```text
supabase/migrations/001_init.sql
supabase/migrations/002_remove_legacy_placeholders.sql
supabase/migrations/003_v05_real_market_core.sql
supabase/migrations/004_v06_exchange_retention.sql
```

`supabase/seed.sql` intentionally inserts **no market assets**.

## 1. Requirements

- Node.js 20.9+.
- A Supabase project.
- A Telegram bot, e.g. `@MemeXMarketBot`.
- A Vercel project connected to the repository.

## 2. Environment

Copy `.env.example` to `.env.local` locally, and configure the same values in Vercel:

```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
TELEGRAM_BOT_TOKEN=123456789:AA...
SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-characters
NEXT_PUBLIC_APP_NAME=MemeX Market
ADMIN_TELEGRAM_IDS=123456789
```

`SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN` and `SESSION_SECRET` are server-only. `ADMIN_TELEGRAM_IDS` is optional; when unset, `/admin` is unavailable to everyone.

## 3. Install and run

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

The authenticated app must be opened from Telegram. There is deliberately no fake browser login route.

## 4. BotFather setup

1. Create/configure `@MemeXMarketBot` in BotFather.
2. Deploy the Next.js project to Vercel.
3. Set the bot's Mini App/menu-button URL to the Vercel HTTPS URL.
4. Open MXM from the bot inside Telegram.

The app posts Telegram `initData` to `/api/auth/telegram`. The server validates it, updates the profile in Supabase and issues a signed HTTP-only session cookie.

## 5. Telegram Gift pipeline

`POST /api/gifts/sync` performs a strict paginated sync.

For every Telegram Unique Gift it requires and stores:

- Telegram `gift_id`, unique `name`, base/collection name and number;
- model name, rarity, file ID, thumbnail and static/animated/video flags;
- symbol name, rarity, file ID, thumbnail and static/animated/video flags;
- backdrop name, rarity and Telegram colors;
- premium/burned/blockchain flags;
- the observed Telegram Gift payload for diagnostics;
- `last_seen_at`.

Each run is written to `gift_sync_runs` with page counts, Telegram totals, imported/updated counts and the exact failure message if the sync fails.

Telegram media is proxied only after the file ID is known to `gift_assets`:

```text
/api/telegram/file/[fileId]
/api/telegram/tgs/[fileId]
```

If required Telegram source data is missing or inconsistent, sync fails. MXM does not invent replacement artwork or Gift metadata.

## 6. Market transaction model

### Cash reservation

Pending Gift offers reserve cash. The profile has:

- `balance` — total MXM cash;
- `reservedBalance` — sum of pending Gift offers;
- `availableBalance` — spendable cash after reservations.

The database RPCs enforce this server-side for:

- Coin buys;
- Coin launch fee;
- Gift Buy Now;
- Gift offers.

### Gift market

- listing/unlisting: `list_virtual_gift`;
- Buy Now: `buy_virtual_gift`;
- offer/update offer: `create_gift_offer`;
- accept/reject: `resolve_gift_offer`;
- cancel own offer: `cancel_gift_offer`.

Completed sales update ownership, balances, realized PnL, missions, market activity and Gift collection candles inside Postgres.

### Coin market

Coins use a constant-product AMM. Buy/sell mutations are server RPCs and completed trades update holdings, market state and minute OHLC candles.

## 7. Main routes

```text
/market              Gifts + Coins market
/gifts/[id]          Gift details / trade / offers / activity / chart
/collections/[name]  Gift collection floor / traits / candles / listings
/coin/[id]           Coin candles / quote preview / buy / sell / holders
/create               Launch a meme coin
/orders               Incoming/outgoing Gift offers + listings
/hub                  Live market feed
/tasks                Onboarding / daily / weekly missions
/vault                Net worth / holdings / Gifts / listings / history
/leaderboard          Six global ranking boards
/profile              Current Telegram profile + Gift sync
/u/[id]               Public player profile
/admin                 Private diagnostics, gated by ADMIN_TELEGRAM_IDS
```

## 8. Realtime

The client uses Supabase Realtime as an invalidation signal for market-facing changes, including:

- `coins`
- `trades`
- `virtual_gifts`
- `gift_trades`
- `market_events` (including public-safe Gift offer invalidation)

`gift_offers` is deliberately not exposed through public Realtime. Offer create/cancel/reject writes an `offer` event to `market_events`; completed offer purchases also emit the normal ownership/trade changes. After an event the page refetches its server API contract. Realtime data is never trusted as the authoritative balance/ownership state.

## 9. Economy in this build

- New account: **$100**.
- Coin launch: **$50**.
- Coin trading fee: **0.5%**.
- Coin supply: **1,000,000,000**.
- Gift/coin market prices only change from player market activity.
- Gift `estimatedValue` only uses available MXM observations (collection/trait floors and collection last sale). With no observations it remains `NULL`/Unpriced.
- Burned Telegram Gifts cannot be listed, offered on, bought or counted as active Gift portfolio value.

## 10. Diagnostics

Set your Telegram numeric ID in `ADMIN_TELEGRAM_IDS` and open `/admin` inside the Mini App.

Diagnostics show:

- player count;
- Telegram Gift asset count;
- active/burned/missing-media source counts;
- listings and pending offers;
- Gift/Coin trade counts;
- latest 20 Telegram Gift sync runs and exact errors.

The diagnostics table is server-only behind RLS and is read with the Supabase server credential.

## 11. Project layout

```text
app/                    Next.js App Router UI + API routes
components/             MXM shell, Gift media/cards, chart, realtime
lib/                    Telegram auth/sync, Supabase, mapping, feed
supabase/migrations/    schema + v0.4 cleanup + v0.5 market core + v0.6 exchange/retention
docs/                   architecture + database upgrade notes
supabase/seed.sql       intentionally contains no market data
```
