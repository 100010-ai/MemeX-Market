# MemeX v0.2 — Telegram Mini App virtual market

A playable first project for a shared Telegram-native game economy. Players start with **$100 virtual cash**, trade player-created meme coins with candlestick charts, import their real Telegram Collectible Gift metadata, and trade **simulated replicas** of those gifts without transferring any real Telegram asset, TON, Stars, or money.

## Stack

- Next.js App Router + TypeScript
- React
- Tailwind CSS 4
- Supabase Postgres
- Vercel target
- Telegram Mini App `initData` server validation
- Telegram Bot API `getUserGifts` / `getFile`
- TradingView Lightweight Charts for OHLC candles
- Lottie Web for Telegram `.tgs` animated gift stickers

## Included in this build

### Telegram
- Server-side HMAC validation of `Telegram.WebApp.initData`
- Profile sync: Telegram ID, username, first/last name, avatar URL
- HttpOnly signed game session; no Supabase secret is exposed to the browser
- `getUserGifts` import for hosted unique Telegram Gifts
- Actual gift metadata stored from Telegram: base name, unique name, number, model, symbol, backdrop, rarity, premium/blockchain flags
- Actual Telegram backdrop colors used in gift cards
- Telegram sticker files proxied through authenticated server routes so the bot token never reaches the browser
- Static, video, and `.tgs` animated model rendering

### Virtual Gift market
- Separate `gift_assets` (Telegram reference metadata) and `virtual_gifts` (game ownership) layers
- Real Telegram gift **never moves** when the virtual replica is bought or sold
- Demo market inventory so local development is not empty before real users import gifts
- Buy-now listings
- Player offers with accept/reject/cancel
- Virtual ownership / sale history
- Collection OHLC market chart
- Collection floor overview
- Vault with owned/listed gifts
- Orders screen

### Meme-coin market
- $100 starting virtual cash
- Player-created coins
- $50 launch fee
- 1B virtual supply
- Constant-product AMM-style curve
- 0.5% virtual trading fee
- Postgres row locks for concurrent buys/sells
- Trade-generated minute OHLC candles
- Candlestick timeframes in the client
- Holdings, cost basis and PnL

### Game layer
- Shared leaderboard: overall, gifts, coins
- Onboarding, daily and weekly missions
- Claimable virtual rewards
- Daily/weekly mission period keys automatically rotate
- Dark compact MRKT-inspired mobile UI, without copying MRKT assets or layout 1:1
- 5-item Telegram-friendly bottom navigation: Market / Orders / Create / Tasks / Vault

## Important game boundary

This project is a **simulator**. `gift_assets` may mirror public/owned Telegram Collectible Gift metadata, but `virtual_gifts.owner_profile_id`, listings, offers, prices and sale history are entirely MemeX state. The app never calls Telegram transfer/resale methods and never handles TON/Stars for these simulated trades.

## 1. Create the Supabase database

Create a Supabase project and execute, in this order:

1. `supabase/migrations/001_init.sql`
2. `supabase/seed.sql`

The migration enables RLS on every game table. The browser does not use direct Supabase table access; authenticated Next.js routes use the server secret key on the server. Transactional economy operations are Postgres RPCs.

## 2. Configure environment variables

Copy:

```bash
cp .env.example .env.local
```

Fill:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=...
# Legacy projects may use SUPABASE_SERVICE_ROLE_KEY instead
TELEGRAM_BOT_TOKEN=...
SESSION_SECRET=at-least-32-random-characters
NEXT_PUBLIC_APP_NAME=MemeX
```

Never expose `SUPABASE_SECRET_KEY`, the legacy `SUPABASE_SERVICE_ROLE_KEY`, or `TELEGRAM_BOT_TOKEN` through `NEXT_PUBLIC_*` variables.

### Local browser development

A normal browser does not provide Telegram `initData`. For local UI testing only:

```env
NEXT_PUBLIC_DEV_AUTH_ENABLED=true
DEV_AUTH_ENABLED=true
```

`/api/auth/dev` rejects requests when `NODE_ENV=production`, even if the variables are accidentally left set.

## 3. Install and run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000` if dev auth is enabled.

## 4. Configure the Telegram Mini App

1. Create/configure your bot through `@BotFather`.
2. Deploy MemeX to an HTTPS URL.
3. Configure that URL as the bot's Main Mini App or Menu Button.
4. Open the app from Telegram.

The client sends the **raw** `Telegram.WebApp.initData` string to `/api/auth/telegram`; the server validates it against `TELEGRAM_BOT_TOKEN` before trusting the user payload.

Current official Telegram docs used by this project:

- Mini App initData validation: `https://core.telegram.org/bots/webapps`
- Bot API gifts / `getUserGifts` / `UniqueGift`: `https://core.telegram.org/bots/api`

## 5. Deploy to Vercel

Import the repository into Vercel and set the same production variables:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (preferred; legacy `SUPABASE_SERVICE_ROLE_KEY` also works)
- `TELEGRAM_BOT_TOKEN`
- `SESSION_SECRET`
- `NEXT_PUBLIC_APP_NAME=MemeX`

Do **not** set the dev-auth variables in production.

The application does not require Supabase during `next build`; database access happens at request time, so missing production credentials do not crash prerendering.

## Main routes

```text
/market             Gifts + meme-coin market
/gifts/[id]         Virtual gift details, traits, chart, trade controls
/coin/[id]          Meme coin candles + buy/sell
/orders             Incoming/outgoing offers + listings
/create             Launch a meme coin
/tasks              Onboarding/daily/weekly missions
/vault              Gift + coin portfolio
/leaderboard        Overall/gift/coin rankings
/profile            Telegram profile + gift sync
```

## API surface

```text
POST /api/auth/telegram
POST /api/auth/dev                 dev only
GET  /api/me
GET  /api/market
GET  /api/coins/[id]
POST /api/coins
POST /api/trade

POST /api/gifts/sync
GET  /api/gifts/[id]
POST /api/gifts/[id]/buy
POST /api/gifts/[id]/list
POST /api/gifts/[id]/offer
POST /api/gifts/offers/[id]
GET  /api/orders

GET  /api/portfolio
GET  /api/leaderboard
GET  /api/tasks
POST /api/tasks/claim

GET  /api/telegram/file/[fileId]
GET  /api/telegram/tgs/[fileId]
GET  /api/health
```

## Security notes

- Telegram auth data is validated server-side and checked for age.
- Session cookies are HttpOnly, SameSite=Lax, Secure in production and signed with HMAC-SHA256.
- The Supabase secret key (or legacy service-role key) is server-only.
- RLS is enabled on all game tables.
- High-risk economy writes run inside Postgres functions with row locks.
- RPC execute permission is revoked from `public`, `anon`, and `authenticated`; only `service_role` is granted access.
- Telegram media proxy accepts only file IDs already present in `gift_assets`, preventing it from becoming a generic bot-token file proxy.
- Gift sync has a short server-side throttle.

## Database model

```text
profiles
  ├─ holdings ─ coins ─ trades ─ candles
  ├─ virtual_gifts ─ gift_assets
  │                  ├─ gift_trades
  │                  ├─ gift_offers
  │                  └─ gift_collection_candles
  └─ user_missions ─ missions
```

`gift_assets` is immutable-ish reference metadata from Telegram. `virtual_gifts` is the game object that can change owner. This split is deliberate: a real collectible and a MemeX replica are never treated as the same ownership record.

## Next upgrades after this MVP

- true pushed live market updates instead of 7–8 second polling
- season table + season history badges
- creator reputation and coin graduation
- collection-wide buy orders
- gift auction mode
- anti-bot / abuse scoring
- referral deep links
- clans/funds once the core economy has enough active players
