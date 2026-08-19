# MXM v0.40 audit

## Scope

Static architecture, API hot paths, Telegram Gift media/data flow, virtual-game settlement, UI density, common client fetch paths, release artifact hygiene and TypeScript/ESLint gates.

## High-impact findings fixed

- Game actions could be retried without a stable server-side idempotency record. `game_rounds.request_key` and a unique per-profile index now prevent duplicate debit from a repeated request.
- Reusing an idempotency key with a different game/bet/choice is rejected instead of returning an unrelated old round.
- `/api/me` previously needed multiple DB round trips. `session_profile_snapshot_v040` returns profile + finance state in one service-role RPC, with rolling-deploy fallback.
- Games no longer calculate the entire portfolio just to show spendable balance.
- Market maintenance work is scheduled after the response; infinite Gift pages use a lean RPC path.
- NFT/collection/coin details sent excessive candle/history payloads. Detail payloads are bounded and collection/market selects are explicit.
- Hub downloaded a full 100-player leaderboard but rendered eight rows. It now requests only eight.
- TonAPI rarity recalculation downloaded up to thousands of assets and issued many updates. v0.40 moves this to one set-based PostgreSQL function over the full collection.
- A stale launch-fee error mapping still mentioned 50 TON while the current fee is 250 TON. Corrected.
- Game UI previously exposed server results while the reveal animation was still running. The result panel now stays hidden until reveal completes.
- Partial payouts below the stake are treated as losses by net PnL rather than as wins merely because payout is non-zero.

## Performance work

- GET request coalescing + short client memory cache.
- Route prewarming after Telegram auth/navigation.
- Direct Fragment preview URLs for known collectible slugs.
- Lottie lazy load, shared JSON LRU, Canvas renderer for compact cards, viewport permit budget and scroll pause.
- 24-Gift initial market page + lean incremental pages.
- 36-listing initial collection page + limit+1 pagination without repeated exact counts.
- Reduced coin/NFT/collection candle windows to 480 points and trimmed activity payloads.
- Server-Timing added to hot detail endpoints for real production profiling.

## Remaining non-blocking debt

- ESLint still reports legacy warnings, primarily `no-explicit-any`, raw `<img>` usage where external Telegram/Fragment media is intentional, and React 19 `set-state-in-effect` advisories around async loaders. There are no lint errors.
- A true production latency/FPS audit still requires a deployed Supabase/Vercel build and Telegram Android/iOS WebViews; static checks cannot measure real network RTT, LCP or device GPU behavior.
- TonAPI/Fragment remain external dependencies. The application has cache/retry/fallback behavior, but cannot guarantee upstream availability.
- Full `next build` in this sandbox can be blocked by the supplied Windows-only SWC binary. `tsc --noEmit` is the authoritative static type gate here.

## Release order

1. Apply migration 017 if not already applied.
2. Apply `018_v040_games_speed_compact.sql`.
3. Set production env and validate `TONAPI_KEY`.
4. Run `npm run release:check`.
5. Run `npm run build` in the actual Linux deployment environment.
6. Smoke-test Market, Gift detail, all seven games, cart checkout, offers/listings and coin trading inside Telegram.
