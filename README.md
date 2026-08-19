# MemeX Market (MXM) v0.10.0

Telegram Mini App for a multiplayer simulated market built with Next.js, TypeScript, Supabase/Postgres and Vercel.

MXM uses **virtual TON only**. It cannot be deposited, withdrawn or redeemed. Telegram collectible Gifts provide real source artwork/metadata, while ownership, listings, offers, trades and PnL inside MXM are simulated and never transfer the real Telegram collectible.

## v0.10 — Instant Trading + Economy Guardrails

- Coin quotes are calculated immediately in the client from the latest authoritative AMM reserves already loaded with the coin page. There is no separate quote HTTP request on every input change.
- The final trade still executes atomically in Postgres; the UI updates optimistically and revalidates in the background.
- `MAX` sell uses a dedicated `sell_coin_all(...)` RPC with the exact database holding, eliminating JS/numeric rounding failures such as `Insufficient token balance` on 100% sells.
- Coin detail and Market requests use sequence guards so an older realtime request cannot overwrite a newer state and produce transient half-updated screens.
- Market cache is explicitly invalidated after coin creation, so a newly launched coin is visible as soon as the user returns to Market.
- `market_overview` now exposes AMM reserves and uses `coalesce(hidden_from_market,false)=false`; new coins are explicitly inserted as `active` and visible.
- Normal coin launches cost **250 virtual TON**, are limited to **3 active coins per creator**, and have a **12-hour launch cooldown**. Local God Mode remains exempt.
- Added `/games` with three virtual-only games: Coin Flip, Dice 49 and Wheel. Odds/payouts are visible in the UI and results are settled server-side.
- Added `game_rounds` audit/history storage and a Russian daily game mission.
- Reduced the heavy panel/pill styling on coin Market and coin detail: transparent/flat tabs, simpler avatars, separator-based stats and fewer nested rounded backgrounds.
- Long category/filter rails remain true horizontal swipe containers in Telegram WebView.

## Database upgrade

If the database is already on v0.9.2, run only:

```text
supabase/migrations/012_v010_instant_trade_games.sql
```

If `010_v09_mrkt_flow.sql` previously failed with `gift_assets.catalog_source does not exist`, apply `011_v092_schema_compat.sql` first, then `012_v010_instant_trade_games.sql`.

The v0.10 migration inserts no mock Gifts, coins, trades, leaderboard users or fallback market data.

## Environment

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
TELEGRAM_BOT_TOKEN=123456789:AA...
SESSION_SECRET=your-own-random-secret-at-least-32-characters
ADMIN_TELEGRAM_IDS=123456789
```

No MTProto user session is required by the production app.

## Local God Mode

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000/control
```

On first local access MXM creates `.mxm-control-secret` and prints the generated local control key in the terminal.

## Real Gift catalogue + NPC liquidity

NPC liquidity never invents Telegram NFT metadata. It can only virtualize Gift assets that were already verified and stored in `gift_assets`.

```text
verified Telegram Gift metadata
        ↓
gift_assets
        ↓
NPC liquidity
        ↓
virtual TON listings
        ↓
players / cart / offers / secondary market
```

## Build

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```
