# MemeX Market — Existing Systems Polish v11

This pass intentionally adds no new product mechanics. It hardens and polishes the systems that already exist.

## P0: Telegram account isolation

- Client GET cache is namespaced by the active Telegram user id.
- Every authenticated API request carries the active Telegram id hint from signed Mini App initData.
- Server-side `requireSession()` rejects a cookie belonging to another Telegram account before player data is read.
- `/api/me` validates the expected Telegram id before returning a profile.
- Account identity is rechecked on Telegram activation, browser focus and visibility changes.
- A request started under an older cache generation cannot repopulate or invalidate the new account cache after an account switch.
- Routes that previously called `readSession()` directly now use the validated session path.

## Gift market / collections / feed

- Realtime subscriptions are scoped to the currently visible market mode instead of refreshing on unrelated market activity.
- Gift market, search, collection sweep and collection reads stay bounded.
- Search gets pg_trgm indexes for collection/model/background/symbol fields.
- Feed cache misses are coalesced so concurrent users share one in-flight DB read.
- Collection/player-only filtering and real-data sweep behavior remain intact.

## Orders / offers

- `gift_offers.seller_profile_id` is persisted and maintained by DB trigger.
- Incoming offer API queries and Realtime subscriptions can be scoped directly to the seller instead of scanning/subscribing to all offers.
- New indexes cover buyer, seller and gift pending-offer paths.

## Portfolio

- Large Gift inventories are paginated; the first screen no longer loads thousands of Gift rows.
- Listed Gifts remain available separately so seller state stays correct.
- Snapshot writes run after the response instead of delaying a read.
- Load-more pages deduplicate Gifts by virtual Gift id.

## Memecoins / creator

- Coin API output is normalized so invalid numeric/date values do not leak NaN into React.
- Creator dashboard RPC output is normalized before it reaches the UI.
- Creator page now reuses startup preload.
- Hot indexes cover holdings-by-coin and creator fee ledger reads.
- Unknown database errors are no longer exposed as raw PostgreSQL messages to players.

## Tasks

- Mission ensure RPC calls are briefly coalesced per player instead of writing on every rapid GET.
- Mission reads are bounded.
- Existing server-verified Telegram channel subscription and clawback logic remain enforced.

## Profile / leaderboard / referrals

- Profile reputation refresh is performed in the background when stale.
- Achievement and referral response mapping is resilient to malformed rows.
- Leaderboard cache misses are coalesced.
- Referral numbers/dates are normalized before rendering.

## Notifications / alerts / watchlist

- Notification hot paths get unread/profile indexes and preference backfill.
- Price alerts have DB-level uniqueness guards against concurrent duplicate creation.
- Existing duplicate active alerts are safely disabled before uniqueness indexes are created.
- Alert/watchlist reads are bounded and numeric fields are normalized.
- Existing atomic notification claiming and Telegram delivery behavior remain unchanged.

## Store / cases / seasons / achievements

- Store, cases and season pages now reuse startup preload instead of forcing an immediate second GET.
- Store catalogue reads are bounded.
- Case and season RPC payloads are normalized before rendering.
- Existing atomic purchase/open/claim RPCs remain the source of truth.
- Achievement reads receive an unlocked-at index.

## Startup / UX / performance

- Existing page preloads now actually survive the first navigation for creator, store, season, cases, collections, profile customization and coin creation pages.
- The flat unified UI rule now also covers structural `section.mxm-card` containers; actual Gift/NFT cards remain card-style.
- Realtime and GET cache invalidation are narrower and safer.

## Database migration

Apply:

`supabase/migrations/9999_existing_systems_polish.sql`

It is idempotent and contains the seller-offer backfill/trigger, hot-path indexes, search indexes, alert dedupe/uniqueness guards and notification preference backfill.

## Verification performed in this environment

- 179 TS/TSX files parsed: 0 syntax errors.
- 80 API route files: 0 handlers missing the common error guard.
- 0 direct `request.json()` calls in API routes.
- Direct `readSession()` API bypasses removed; `/api/me` is the only intentional direct reader because it performs explicit expected-account validation.
- 54 runtime relations/views referenced by application code: 0 missing in migration set.
- 79 RPCs referenced by application code: 0 missing definitions in migration set.
- Product/security/domain checks in `release:check` pass.

The complete `next build` and ESLint stages cannot run in this container because the archive does not contain `node_modules` and the environment cannot retrieve packages from npm. The release gate therefore reports those two infrastructure stages as blocked; this report does not claim a green production build that was not executed.
