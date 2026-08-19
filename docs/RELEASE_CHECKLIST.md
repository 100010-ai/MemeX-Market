# MXM Release Checklist

Run this before every production deploy:

```bash
npm run release:check
```

## Database

- Apply every migration through `017_v030_market_foundation.sql` in order.
- Confirm `gift_market_overview`, `gift_collection_overview`, `gift_market_random_page`, `buy_virtual_gift_v2`, `list_virtual_gift_v2`, `create_gift_offer_v2`, and `resolve_gift_offer_v2` exist.
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
- Mutating API routes require authenticated session + same-origin validation + rate limits.
- Balance/ownership/price changes happen in server-side Postgres RPCs, never from client state.
- Admin/control routes remain inaccessible without their dedicated authorization.

## Deploy smoke test

After Vercel/Railway deployment, test inside Telegram WebView, not only desktop Chrome. Verify Market, Gift detail, Collections, Cart, coin trading and profile once before announcing the release.
