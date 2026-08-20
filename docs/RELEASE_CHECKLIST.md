# MXM Release Checklist

Run this before every production deploy:

```bash
npm run release:check
```

## Database

- Apply every migration through `029_market_scalability.sql` in numeric order.
- Confirm `gift_market_overview`, `gift_collection_overview`, `gift_market_random_page`, `gift_market_filtered_page_v200`, `buy_virtual_gift_v2`, `list_virtual_gift_v2`, `create_gift_offer_v2`, and `resolve_gift_offer_v2` exist.
- Confirm service-role-only execution on trading RPCs.
- Check `/api/system/market-health` from an authenticated MXM session: database errors must be empty.

## Telegram Gifts

- Open Market → Gifts and verify at least three collections.
- Open a static and an animated Gift. Backdrop, model, symbol and number must match the Telegram collectible.
- Confirm no raw TonAPI 401/403 error reaches the UI.
- Confirm a Gift can be opened by virtual ID and Telegram slug.
- Confirm external quotes show a source and timestamp; stale external quotes must not be presented as current.

## Trading

- List a Gift, reprice it, then unlist it.
- Create/cancel an offer and accept an offer from another test account.
- Double-submit a Gift purchase with the same idempotency key; it must produce one purchase only.
- Repeat the same test for cart checkout (`buy_virtual_gift_cart_v2`); the whole cart must commit once or roll back as a unit.
- Try two buyers against the same listing; row locks must allow one winner only.
- Confirm expired user listings/offers are removed by market maintenance. Genesis/NPC inventory must stay listed while its external TON quote is fresh and disappear when that quote becomes stale.
- Confirm fee and seller-net values match `market_settings.gift_fee_bps`.

## Removed games

- `/games` must redirect to `/market`.
- `/api/games` and `/api/games/play` must not exist.
- `daily_game_3` must be inactive after migration 019.
- Historical `game_rounds` data may remain in Postgres for audit/rollback compatibility.

## Removed advertising

- Advertising, reward callback and sponsored-task API routes must return 404.
- `/moderation` and `/reward-confirmations` must not exist.
- No advertising SDK, environment variable, runtime flag, admin panel or notification preference may ship.
- Migration 028 must remove live advertising sessions/campaigns and their claim functions while leaving generic ledger history intact.

## Telegram Stars refunds

- Refund a paid test purchase and confirm the Telegram Bot API succeeds before the local status becomes `refunded`.
- Confirm the refund appears in the mandatory queue on both Admin → Overview and Admin → Economy with purchase, product, profile, charge, time and reason.
- Complete the queue item with meaningful review notes. A second submission must be idempotent, and the audit metadata must state that no automatic virtual-benefit reversal was claimed.
- In Admin → Overview and Economy, verify DAU/MAU, rolling M1 retention, 24-hour turnover/trade count, and the top Gift collection, memecoin and Store SKU lists. Empty periods must render as empty states, not errors.

## MXM Store and Stars checkout

- Open every Store category and confirm the Stars price/reward comes from `store_products`; prices below 5 Stars must be rejected.
- Confirm `/terms` and `/paysupport` open without an authenticated Mini App session and `/paysupport` reaches the configured human support account.
- Try paying a forwarded invoice from a different Telegram account; pre-checkout must reject it.
- Start two checkouts for the same one-time item and two buyers for the final limited case. Only one authorization may reserve each grant/stock unit.
- Abandon an authorized checkout, wait through the configured expiry + grace period, reopen Store and verify stock/eligibility is restored.
- Re-send the same `successful_payment`; fulfilment must be idempotent only for the identical payer, amount and Telegram charge ID.
- Confirm MXM packs have usable sinks, case odds are visible before purchase, and a full-Energy/refunded/already-owned purchase is disabled or rejected.

## Memecoins

- Create a coin and confirm it appears immediately.
- Buy, sell, and MAX-sell.
- Check slippage validation and duplicate request protection.
- Test chart pinch zoom, crosshair, timeframes and fullscreen mode.

## Performance

Append `?perf=1` once to enable the hidden performance overlay. Check:

- scrolling stays close to 60 FPS on the target phone;
- no more than the configured Gift animation budget is active;
- API latency/error counters do not continuously grow while idle;
- realtime channels are subscribed, not degraded;
- heap/DOM counts do not grow indefinitely after scrolling down and back up.

Disable with `?perf=0`.

## Security

- No `.env`, `.env.local`, `.mxm-control-secret`, service-role key, bot token or session secret in the ZIP/repository.
- Mutating API routes require authenticated session + same-origin validation + rate limits, including expensive admin synchronization actions.
- Balance/ownership/price changes happen in server-side Postgres RPCs, never from client state.
- Admin/control routes remain inaccessible without their dedicated authorization.

## Deploy smoke test

After Vercel/Railway deployment, test inside Telegram WebView, not only desktop Chrome. Verify Market, Gift detail, Collections, Cart, coin trading and profile once before announcing the release.
