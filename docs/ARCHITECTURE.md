# MXM v0.4 Architecture

## Runtime

```text
Telegram Mini App
      │ initData
      ▼
Next.js 16 / Vercel
      │
      ├── server route handlers
      │      ├── Telegram initData verification
      │      ├── Telegram Bot API Gift sync/media
      │      └── Supabase RPC transactions
      │
      └── client UI
             ├── Tailwind CSS
             ├── lightweight-charts
             └── Supabase Realtime subscriptions
                    │
                    ▼
             Supabase / Postgres
```

## Trust boundary

The browser never receives `TELEGRAM_BOT_TOKEN` or `SUPABASE_SECRET_KEY`.

All operations that can change balance, ownership, positions, offers or rewards execute through Next.js route handlers and Postgres functions. The client sends intent only.

## Authentication

1. Telegram injects `window.Telegram.WebApp.initData`.
2. The client sends that exact string to `/api/auth/telegram`.
3. The server verifies the Telegram signature and freshness.
4. `sync_telegram_profile` inserts or updates the profile.
5. Next.js sets an HTTP-only signed `mxm_tg_session` cookie.
6. Protected API routes resolve the profile from that signed session.

## Coin market

`coins` stores the current AMM state:

- `token_reserve`
- `quote_reserve`
- `current_price`
- `market_cap`

`buy_coin` and `sell_coin` lock the affected profile, coin and position rows, calculate the trade, write `trades`, update reserves/holdings, then update the current OHLC bucket.

No client-side balance calculation is authoritative.

## Gift catalog

A Telegram collectible has two MXM layers:

### `gift_assets`

Immutable/observed Telegram identity and visual metadata:

- Telegram unique name
- collection/base name
- collectible number
- model + rarity + Telegram file ID
- symbol + rarity + Telegram file ID
- backdrop + rarity + Telegram colors
- premium/blockchain flags

### `virtual_gifts`

MXM game state:

- virtual owner
- acquisition price
- listing price
- last MXM sale
- listing status

A virtual MXM trade never transfers the underlying Telegram collectible.

## Gift valuation

`gift_market_overview.estimated_value` uses only MXM observations that actually exist for that asset context:

- collection floor
- model floor
- backdrop floor
- symbol floor
- collection last sale

The view averages the available observations. With zero observations the value is `NULL`, so the UI shows an unpriced asset.

## Gift transaction paths

### Listing buy

`buy_virtual_gift`:

1. locks buyer + virtual Gift;
2. resolves seller and locks seller profile;
3. validates current listing and buyer balance;
4. moves virtual balance;
5. moves virtual ownership;
6. records the Gift trade and realized PnL;
7. closes outstanding offers;
8. records the collection candle;
9. advances mission progress.

### Offer

- `create_gift_offer`
- `resolve_gift_offer`
- `cancel_gift_offer`

Acceptance performs the same balance/ownership consistency checks inside Postgres.

## Realtime

The browser subscribes to market-facing tables:

- `coins`
- `trades`
- `virtual_gifts`
- `gift_trades`
- `market_events`

A change invalidates the relevant page state and triggers a fresh API read. Realtime events are a refresh signal; route/API responses remain the data contract rendered by the UI.

## Missions

`missions` defines rules. `user_missions` stores a player's period-specific progress. Daily and weekly rows are created with period keys, so progress resets by period without deleting historical rows.

Mission progress is advanced by server-side market functions. `claim_mission` validates completion and performs the balance reward transaction.

## Leaderboard

The `leaderboard` view calculates:

- cash balance
- current coin portfolio value
- priced Gift portfolio value
- net worth
- realized PnL
- trade counts
- Gift count
- total active market cap created by the player

`/api/leaderboard` ranks in Postgres and calculates the current user's global rank from the same metric.

## RLS and keys

Public Realtime reads use the Supabase publishable key with read-only policies on market tables. Application mutations use the server-side Supabase secret key and explicitly restricted RPC functions.
