# MXM Market v0.40.0


## v0.40 — Audit, Games 2.0, Speed

- Games hub redesigned around compact game cards instead of game tabs.
- Real animated wheel and CSS 3D dice, plus Slots, HiLo, Roulette and 8-row Plinko.
- Game RPC now supports request idempotency and rejects reused keys with changed parameters.
- Hot reads were reduced: one-round-trip `/api/me`, lean market pagination, smaller NFT/coin chart payloads, bounded leaderboard payloads, explicit DB selects and server timing headers.
- Telegram Gift rarity recalculation moved to one set-based PostgreSQL update instead of downloading/updating thousands of rows in JavaScript.
- Gift media keeps viewport/motion budgets, direct Fragment previews and lazy Lottie.
- Global density pass shortened labels/copy and tightened navigation, profile, vault, tasks, hub, market, collections and game controls.
- Release audit checks migrations 017 + 018, game engine, fast snapshot, market pagination, media path and secrets.

**Required DB migration after v0.40:** `supabase/migrations/019_v041_remove_games_interface.sql`.

Telegram Mini App: simulated secondary market for Telegram collectible Gifts plus player-created memecoins. Next.js, TypeScript, Supabase/Postgres and Vercel.

> MXM uses **virtual TON only**. It cannot be deposited, withdrawn or redeemed. Telegram collectible Gifts supply real public metadata/media references; ownership, listings, offers, trades and PnL inside MXM are simulated and never transfer the real Telegram collectible.

## v0.30 — Market Foundation

This release consolidates the v0.14–v0.18 fixes into a stricter market architecture instead of adding more one-off fallbacks.

- **Gift resolver:** one canonical resolver accepts the MXM virtual Gift UUID, asset UUID, Telegram collectible slug, `t.me/nft/...` URL and TON NFT address. Detail pages and mutations stay attached to the canonical virtual Gift ID.
- **TonAPI reliability:** timeout, bounded retries/backoff, public 4.15s pacing, invalid-token 401/403 fallback, memory cache, stale-on-failure reads and a circuit breaker. Provider health is exposed to the authenticated diagnostics endpoint without exposing secrets.
- **Real price provenance:** no synthetic NFT valuation. MXM separates its own listing, external native-TON listing, item last sale and collection last sale. External quotes expire from the live-reference view after the configured freshness window.
- **Market data:** collection/MXM floors, model/backdrop/symbol floors, best offer, 24h/7d volume and sales, listed percentage, all-time volume, high sale and external floor.
- **NFT detail 2.0:** price source/timestamp, floor premium, trait floors, offers, activity timeline, listing/offer expiries and price chart.
- **Trading hardening:** listing/repricing/unlisting history, offer expiry, atomic row-locked purchase/offer acceptance, atomic multi-item cart checkout, server-side balance validation, marketplace fee support and idempotent purchase request keys.
- **Finite Genesis:** system Gifts remain a one-time release pool; once bought by players they are not recreated by NPC liquidity. Genesis accepts only fresh native-TON quotes, keeps system inventory listed without a user TTL, and hides it when the external quote becomes stale.
- **Collections 2.0:** filters by model/backdrop/symbol, search, rarity/price/offers/newest sorting, exact database-side trait aggregation, paginated active listings, expanded market metrics, trait floors, recent sales and fullscreen price chart.
- **Memecoin chart:** chart data no longer rebuilds the chart object for every data update; timeframes, crosshair, volume, pinch zoom and fullscreen mode are retained.
- **Performance diagnostics:** `?perf=1` enables FPS, DOM, media budget, Lottie cache, API latency/errors, realtime state and JS heap counters. `?perf=0` disables it.
- **Release gate:** `npm run release:check` checks critical files, secret hygiene, TypeScript and ESLint before deployment. See `docs/RELEASE_CHECKLIST.md`.

### Database upgrade

After migrations through v0.16 are present, apply:

```text
supabase/migrations/017_v030_market_foundation.sql
```

The migration creates/updates the market settings, price-observation and listing-history infrastructure plus the v2 Gift trading RPCs/views. Apply it before deploying the v0.30 application code.

## v0.17 — Build fix + TonAPI auth fallback

- Fixed the TypeScript production-build failures in `app/api/gifts/[id]/route.ts` caused by Supabase narrowing the fallback row to `{ model_preview_url: null }`. Detail rows now normalize into an explicit `GiftMarketRow` before property access.
- Fixed the incompatible PostgREST response cast in `app/api/gifts/media/[assetId]/route.ts`; primary and legacy reads are normalized into `GiftMediaRow` without pretending one Supabase response type is another.
- If a configured `TONAPI_KEY` is expired or invalid and TonAPI returns 401/403, the importer retries once without the key and switches to the public rate limiter instead of emptying the whole Gifts market.
- Bootstrap errors no longer dump the raw collection endpoint for the common invalid-key case.
- No database migration is required when upgrading from v0.16.

MXM uses **virtual TON only**. It cannot be deposited, withdrawn or redeemed. Telegram collectible Gifts provide real source artwork/metadata, while ownership, listings, offers, trades and PnL inside MXM are simulated and never transfer the real Telegram collectible.


## v0.16 — NFT Detail Route Reliability

- Fixed NFT cards opening into `Gift not found`: the detail API now resolves the canonical `virtual_gift_id` and also accepts the underlying asset UUID or Telegram collectible slug for backward-compatible links.
- Removed fragile detail-only media filters that could hide a Gift which was already visible in the market.
- All detail queries now use the resolved canonical virtual Gift ID, so trades, offers, cart state and mutations stay attached to the correct item.
- Collection/candle/trait analytics degrade gracefully instead of making the entire NFT page fail when an auxiliary stats query is unavailable.
- Failed detail loads now show a compact retry state with navigation instead of a giant permanent skeleton.
- Added `016_v016_gift_detail_schema_repair.sql`: it safely re-applies the real-price/media schema for deployments that skipped migration 015.

## v0.15 — Correct Telegram Gift Backdrops + Full Fragment Animations

- TonAPI Gift cards no longer render a transparent model on a black square. MXM now uses Fragment's official full collectible preview (`*.large.jpg`) which already contains the exact Telegram backdrop and symbol pattern.
- Animated cards use Fragment's official full collectible Lottie (`*.lottie.json`) through the same-origin media proxy. The old `t.me/nft` TGS path is no longer preferred because that asset can represent only the transparent model sticker layer.
- The static full preview stays visible while Lottie is loading and remains as a fallback if animation is unavailable, eliminating black flashes and empty cards.
- Newly imported TonAPI assets store Fragment full-render media URLs when the Telegram collectible slug is known. Existing database rows are fixed at request time, so **no new SQL migration is required** for v0.15.
- Media responses are host-whitelisted, size-limited, validated and CDN-cacheable.

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

## Legacy v0.10 database upgrade

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

## v0.12 — Real Gift Bootstrap + Trading/Chart/Security Polish

- The empty Gift-market problem is fixed at its source. On the first Gift-market request, MXM can import a bounded cohort of **real exported Telegram Gift NFTs from TON through TonAPI**, then release real rows into the finite Genesis pool. No fake Gift, fallback artwork or generated trait is inserted.
- The existing Bot API catalogue remains an additional source for real Gifts from explicitly known Telegram users. TonAPI is used for on-chain exported collectibles; Bot API data keeps exact Telegram model/symbol/backdrop rarity when available.
- No MTProto user session, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` or `TELEGRAM_USER_SESSION` is required.
- `TONAPI_KEY` is optional. Without it the importer respects TonAPI's public rate limit. If a configured key is rejected with 401/403, MXM retries anonymously and enables the same public limiter; normal gameplay never waits on TonAPI after the catalogue has been populated.
- Catalogue import validates NFT identity, collection/source signals, real media and real model/background/symbol metadata. Incomplete rows are skipped rather than repaired with placeholder data.
- Rarity for TonAPI-only rows is recomputed from the real imported cohort of that collection. It is an empirical catalogue frequency; Bot API rows continue to use Telegram-provided rarity metadata.
- The finite Genesis logic is unchanged: system inventory is released once, players buy it, and subsequent supply is player-to-player.
- Telegram authentication is resilient to short `/api/me`/network failures and no longer replaces an already authenticated UI with a false session screen.
- Coin charts now have 1m/5m/15m/1h/4h/1d aggregation, volume histogram, crosshair OHLC inspection, dynamic small-price precision, fit-content control and touch-friendly zoom/scroll.
- Coin detail loads only the latest bounded candle history and recent trades instead of pulling an unnecessarily large history on every open.
- Client quotes stay instantaneous, while `buy_coin_v2`, `sell_coin_v2` and `sell_coin_all_v2` recompute under Postgres locks and enforce the user's minimum output/slippage before committing balances and reserves.

### Database upgrade from v0.11

Run only:

```text
supabase/migrations/014_v012_tonapi_polish.sql
```

After the migration, opening the Gift market can bootstrap the first real cohort automatically. In local God Mode, **Загрузить реальные Gifts** performs a broader catalogue pass, and **Выпустить Genesis** releases the imported finite inventory.


## v0.13 — Gift Market Loading Hotfix

- Gift-market reads are now read-only and fast. TonAPI catalogue import and Genesis release no longer run inside `GET /api/market`; an explicit bounded `POST /api/gifts/bootstrap` performs the first real catalogue bootstrap instead.
- Fixed a realtime request race that could leave the Gift skeleton visible forever when Genesis inserts arrived while the initial Market request was still running.
- Market realtime refreshes are coalesced more aggressively, preventing a burst of catalogue/listing writes from causing a request storm in Telegram WebView.
- Client API calls now have abortable timeouts and preserve caller abort signals, so a stalled request cannot leave the interface permanently waiting.
- TonAPI sync now reports per-collection failures, records partial errors, and fails the bootstrap if every selected collection fails instead of marking the run as healthy.
- TonAPI cards prefer static NFT images/previews before animation/content URLs, avoiding broken `<img>` cards when metadata contains a non-image animation URL.
- Burned/zero-owner on-chain NFTs are ignored during catalogue import.
- Empty Gift market gets an automatic first bootstrap plus a visible retry action if TonAPI is temporarily unavailable.
- Late pagination/bootstrap responses are ignored after switching Market tabs, so an in-flight Gift request cannot overwrite the Coins view.
- Removed the obsolete MTProto session helper from the project; production remains Bot API + TonAPI only.

No new database migration is required beyond `014_v012_tonapi_polish.sql`.


## v0.41 — UI cleanup and temporary game removal

- Games are removed from navigation and public API routes for now. Existing historical `game_rounds` data is preserved.
- Apply `019_v041_remove_games_interface.sql` to disable the game mission.
- Mobile navigation is reduced to five primary destinations and uses a floating compact bar.
- Market controls, filters, cards, top bar and desktop sidebar received a unified dark product UI pass.
