# MXM v0.5 Architecture

## Runtime

```text
Telegram Mini App
      │ signed initData
      ▼
Next.js 16 / Vercel
      │
      ├── authenticated route handlers
      │      ├── Telegram initData verification
      │      ├── Telegram Gift sync + media proxy
      │      ├── admin diagnostics
      │      └── Supabase RPC transactions
      │
      └── client UI
             ├── Tailwind CSS
             ├── lightweight-charts
             └── Supabase Realtime invalidation
                    │
                    ▼
             Supabase / Postgres
```

## Trust boundary

The browser never receives the Telegram bot token or Supabase secret key. Balance, holdings, ownership, offers, rewards and coin launch state can only mutate through server handlers + database RPCs.

## Telegram Gift source model

`gift_assets` is observed Telegram source data. MXM requires the unique Gift identity, model, symbol, backdrop, rarities and Telegram sticker IDs before the asset is accepted. `telegram_payload` retains the observed source object for diagnostics and `last_seen_at` records the latest successful observation.

`virtual_gifts` is MXM market state. It stores the MXM owner, acquisition cost, listing price, last sale and listing status. This is intentionally separate from Telegram custody.

`gift_sync_runs` is server-only observability. Every sync is `running → succeeded|failed` and captures counts plus the exact failure text.

## No source-data substitution

The Gift renderer accepts only Telegram file IDs from `gift_assets`. Static stickers are proxied directly, video stickers render as video, and TGS stickers are decoded through the authenticated TGS route and rendered by Lottie. A failed Telegram media request renders an error state; it is not replaced by emoji/generated art.

## Cash reservation

A pending Gift offer is a cash commitment. `pending_gift_offer_total` is used by spend RPCs so that one player cannot create multiple offers and then spend the same cash on coins, coin launch or Buy Now.

Client `availableBalance` is informational. Postgres performs the authoritative check under row locks.

## Gift transactions

`list_virtual_gift`, `create_gift_offer`, `buy_virtual_gift` and `resolve_gift_offer` reject assets currently marked burned by Telegram.

A completed Gift sale atomically:

1. validates current ownership/listing/offer state;
2. validates spendable balance after other pending offers;
3. moves MXM cash;
4. moves MXM Gift ownership;
5. closes conflicting pending offers;
6. records `gift_trades` + seller realized PnL;
7. updates the collection candle;
8. advances relevant missions.

## Gift market observations

`gift_market_overview` exposes the current Gift, listing, live offer depth and an estimated value derived only from observations that exist. Active floors exclude burned assets.

`gift_collection_overview` is calculated from non-burned Gift assets and reports item/holder/listing counts, floor, last sale, 24h volume/trades and 24h movement.

`gift_collection_candles` are rebuilt from completed Gift sales during the v0.5 migration and maintained at one-minute resolution afterwards.

## Coins

Player-created coins use the Postgres constant-product AMM. `buy_coin` respects Gift-offer cash reservations. Coin trades maintain holdings, market state, trade history and minute candles.

## Leaderboard

The v0.5 view calculates cash, Coin value, non-burned Gift value, net worth, Coin/Gift realized PnL separately, total realized PnL, trade counts, Gift count and creator market cap.

## Realtime

Realtime events invalidate API state; they do not become the trusted state themselves. Market, Gift detail, Orders and Vault subscribe to the relevant market tables and refetch their authenticated API representation. Private `gift_offers` rows are not published; offer mutations emit a public-safe `market_events` invalidation instead.

## Admin diagnostics

`/admin` is not linked as a public navigation item. The API allows only Telegram IDs listed in `ADMIN_TELEGRAM_IDS`. It reports aggregate market health and recent `gift_sync_runs`; it does not expose server secrets.

## v0.6 exchange and retention layer

- `user_watchlist` persists followed meme coins and Telegram Gift collections. Gift watches target `base_name`, so ownership transfers do not invalidate them.
- `profile_xp_events` is an idempotent XP ledger. XP is awarded by database triggers only for completed coin trades, completed Gift trades, coin launches and claimed missions.
- `profiles.xp` is a materialized total rebuilt from the XP ledger during the v0.6 migration and incremented transactionally for new events.
- Coin quote previews are calculated server-side from the same constant-product reserves and 0.5% fee used by the trading RPCs. Quotes are informative; the mutation RPC remains the source of truth and re-checks balance/reserves under row locks.
- Gift collection pages use `gift_collection_overview`, `gift_collection_candles`, actual completed `gift_trades` and current `gift_market_overview` listings. No collection price series is synthesized.
