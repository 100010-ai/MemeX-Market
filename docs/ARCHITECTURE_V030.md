# MXM v0.30 Market Architecture

## Telegram Gifts data flow

```text
TonAPI collection/index data
        |
        v
resilient TonAPI client
(timeout + retry + pacing + coalescing + cache + circuit breaker)
        |
        v
Gift importer / normalizer ----> Fragment full-render media URLs
        |
        v
gift_assets (canonical external identity + traits + quote provenance)
        |
        +----> Gift resolver (virtual UUID / asset UUID / slug / t.me URL / TON address)
        |
        v
virtual_gifts (MXM ownership/listing state)
        |
        +----> gift_market_overview / gift_collection_overview
        +----> detail / collections / market UI
```

There is no synthetic external price path. An external listing is live only while `resale_seen_at` is inside `market_settings.external_quote_hours`. Older observations stay historical but stop driving current price/reference/Genesis inventory.

## Trading invariants

All balance and ownership mutations execute inside PostgreSQL `security definer` RPCs available only to the server service role.

- Listing/repricing/unlisting: `list_virtual_gift_v2`
- Offer create/update: `create_gift_offer_v2`
- Direct purchase: `buy_virtual_gift_v2`
- Atomic cart purchase: `buy_virtual_gift_cart_v2`
- Offer resolution: `resolve_gift_offer_v2`
- Expiry/operational cleanup: `expire_market_orders`

Purchases lock Gift rows first and balance rows in deterministic UUID order. Prices and balances are re-read in the same transaction. Successful purchase request keys are persisted, so a network retry cannot settle the same purchase twice.

## Finite Genesis

Genesis accepts only verified, non-burned assets with a fresh observed native-TON listing. System-owned inventory has no user listing TTL. It stays available until a player buys it or the external quote becomes stale. Player-owned Gifts are never recreated by NPC liquidity.

## Performance model

- Gift cards use `content-visibility` and CSS containment.
- Only a small viewport budget of Gift animations is active; off-screen Lottie/video is paused/unmounted.
- Market pages use bounded incremental pagination instead of loading the complete catalogue.
- Realtime refreshes are coalesced and scheduled outside the hot scroll path.
- Coin charts keep one chart instance while updating series data, with RAF-throttled crosshair state.
- `?perf=1` exposes an internal overlay for FPS, DOM, media budget, API/realtime state and heap where supported.

## Release gate

`npm run release:check` verifies critical v0.30 files/RPC markers, obvious secret leakage, TypeScript and ESLint. Production still requires applying migration 017 and running the Telegram WebView smoke checklist in `docs/RELEASE_CHECKLIST.md`.
