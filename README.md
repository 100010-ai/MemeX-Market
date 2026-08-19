# MemeX Market (MXM) v0.11.0

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

## v0.11 — Telegram Session Fix + Visible Games + Finite Genesis Gift Market

- Telegram auth is now session-first: normal page navigation reuses the signed MXM cookie and does not call `/api/auth/telegram` again.
- The Telegram auth rate-limit is keyed by the validated Telegram user instead of one shared `anonymous` bucket, removing random `Слишком много попыток входа` screens for legitimate users.
- `/games` is now a first-class bottom/desktop navigation destination.
- The Gift market starts from a finite **Genesis pool** made only from verified real Telegram Gift assets already present in `gift_assets`.
- Genesis assets are released by system market makers once. Purchased system inventory is never automatically replenished; after the primary pool is bought, supply comes from player listings/offers.
- Rarity tiers are derived from real Telegram `rarity_per_mille` metadata. They are used only to mix the initial release order and pricing; no Gift traits are generated.
- Gift cards expose the rarest real trait percentage without a synthetic rarity badge.
- Default Gift order is stable-random per market session. The market uses incremental loading so all active listings can be browsed without downloading the entire catalogue on first paint.
- Local God Mode `Выпустить Genesis` can release up to 1000 remaining verified Genesis assets in one administrative run.

### Database upgrade from v0.10

Run only:

```text
supabase/migrations/013_v011_genesis_market_auth.sql
```

`013` creates no demo/mock/fallback Gifts. If the verified Telegram catalogue is empty, the Genesis pool stays empty instead of inventing assets.
