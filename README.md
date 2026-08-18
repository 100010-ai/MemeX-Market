# MemeX Market (MXM) v0.4

Telegram Mini App for a multiplayer virtual market built with **Next.js, TypeScript, Tailwind CSS, Supabase and Vercel**.

MXM has two connected markets:

- **Coins** — player-created virtual meme coins with server-side trading, positions, OHLC candles, volume, holders and market cap.
- **Gifts** — virtual ownership and trading around metadata synced from the user's real Telegram Unique Gifts. The Telegram collectible itself is never transferred by MXM.

The app starts each new profile with **$100 virtual balance**.

## v0.4 changes

- Removed every legacy demo Gift and seeded demo coin.
- Gift cards no longer show a VIRTUAL badge.
- Gift model media, symbol pattern, backdrop colors, name, number and rarity come from Telegram data only.
- Mobile header no longer duplicates the MXM/MemeX brand shown by Telegram.
- Market UI was rebuilt around a compact Telegram-native marketplace layout.
- `002_remove_legacy_placeholders.sql` cleans databases that were previously initialized with v0.2.

## Included in v0.4

- Telegram Mini App session verification on the server.
- Telegram profile sync: Telegram ID, name, username and avatar.
- Supabase/Postgres as the source of truth for balances, positions, ownership, orders and missions.
- Player-created meme coins with a $50 launch fee.
- Server-side constant-product coin trading.
- OHLC candle aggregation from completed coin trades.
- Real Telegram Unique Gift metadata sync via the Bot API.
- Gift model, symbol, backdrop, rarity, number and Telegram media rendering.
- Virtual Gift listings, instant buys and offers.
- Gift sale history, collection floor, trait floors and collection candles.
- Vault with cash, coins, Gifts, listings and transaction history.
- Daily, weekly and onboarding tasks.
- Global leaderboards: overall, realized PnL, Gift portfolio and coin creators.
- Public player profiles.
- Realtime market refresh through Supabase Realtime.
- Live Market Hub/feed.
- Dark mobile-first MXM interface designed for Telegram.

## 1. Requirements

- Node.js 20.9+.
- A Supabase project.
- A Telegram bot, for example `@MemeXMarketBot`.
- A Vercel project connected to this repository.

## 2. Supabase

Open **Supabase → SQL Editor** and execute:

```text
supabase/migrations/001_init.sql
supabase/migrations/002_remove_legacy_placeholders.sql
```

Run the migrations in that order. `002_remove_legacy_placeholders.sql` is also safe on a fresh database and removes the old v0.2 placeholder rows on an upgraded database.

`supabase/seed.sql` intentionally contains no market assets. Coins are created by players and Gift assets enter MXM only through Telegram Gift sync.

### Realtime

The migration adds the public market tables used by the client to the `supabase_realtime` publication and creates read-only RLS policies for those streams. All balance-changing operations remain server-side RPC calls.

## 3. Environment

Copy `.env.example` to `.env.local` for local tooling or add the same values in **Vercel → Project → Settings → Environment Variables**.

```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
TELEGRAM_BOT_TOKEN=123456789:AA...
SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-characters
NEXT_PUBLIC_APP_NAME=MemeX Market
```

`SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN` and `SESSION_SECRET` are server-only secrets. Do not expose them through `NEXT_PUBLIC_*` variables.

## 4. Install and run

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

The authenticated product must be opened as a Telegram Mini App because the server requires Telegram `initData`. There is no browser-only development login route.

## 5. Telegram BotFather setup

1. Create/configure the bot in BotFather.
2. Deploy the Next.js project to Vercel and copy the HTTPS production/preview URL.
3. Set the Mini App / menu button URL to that HTTPS URL.
4. Open the app from the bot inside Telegram.

The Mini App posts Telegram `initData` to `/api/auth/telegram`. The route validates the signature with `TELEGRAM_BOT_TOKEN`, creates/updates the Supabase profile and issues an HTTP-only MXM session cookie.

## 6. Gift sync

The **Sync** action calls `/api/gifts/sync`.

MXM requests the current Telegram user's Unique Gifts, stores their Telegram metadata, then creates one virtual MXM ownership record for each synced collectible. The Telegram Gift remains in Telegram; buying/selling it in MXM only changes the MXM owner and virtual balance in Postgres.

Telegram media is served through authenticated server routes:

```text
/api/telegram/file/[fileId]
/api/telegram/tgs/[fileId]
```

If Telegram does not return required media or trait metadata, the sync fails for that request instead of inserting invented asset data.

## 7. Main routes

```text
/market              Gifts + Coins market
/gifts/[id]          Gift detail / offers / activity / chart
/coin/[id]           Coin detail / candles / buy / sell
/create               Launch a meme coin
/orders               Incoming/outgoing Gift offers + listings
/hub                  Live market feed + ranking preview
/tasks                Onboarding / daily / weekly missions
/vault                Portfolio, assets, listings, history
/leaderboard          Global rankings
/profile              Current Telegram profile
/u/[id]               Public player profile
```

## 8. Economy rules in this build

- New account balance: **$100**.
- Coin launch fee: **$50**.
- Coin buy/sell fee: **0.5%**.
- Coin supply: **1,000,000,000**.
- Coin prices are changed only by completed player trades.
- Gift collection prices/candles are changed only by completed virtual Gift sales/listings where applicable.
- Gift estimated value is calculated only from available MXM market observations: collection floor, matching trait floors and collection last sale. If there are no observations, the asset remains unpriced.

## 9. Production deployment

Before the first real test:

```bash
npm run typecheck
npm run lint
npm run build
```

Then deploy to Vercel, configure the environment variables, apply the SQL migration in Supabase, and point the BotFather Mini App URL to the Vercel deployment.

## 10. Project layout

```text
app/                    Next.js App Router pages + API routes
components/             MXM UI, Telegram provider, charts, Gift media
lib/                    auth, Telegram, Supabase, mappers, market feed
supabase/migrations/    Postgres schema, RPCs, RLS, views, missions
supabase/seed.sql       no generated market content
docs/ARCHITECTURE.md    system architecture and transaction model
```
