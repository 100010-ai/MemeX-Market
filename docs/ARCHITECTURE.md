# MXM v0.9 Architecture

## Product boundary

MXM is a simulated Telegram Gift + memecoin market denominated in **virtual TON**. Real Telegram collectible data is used only as the source identity/media/traits for Gift assets. Buying or selling in MXM never transfers, withdraws or redeems a real Telegram collectible or real TON.

## Authentication

- Telegram Mini App sends `initData` to the server.
- Server verifies Telegram signature and freshness.
- A signed HttpOnly session identifies the MXM profile.
- Balance-changing actions require the server session and same-origin mutation checks.

## Gift catalogue

Production does **not** require MTProto, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` or a Telegram user-session.

Verified real Gift metadata enters `gift_assets` through explicit server/admin catalogue synchronization using the supported Telegram Bot API source accounts configured in the database. Missing source metadata or media is rejected; the app does not manufacture substitutes.

`gift_assets` is source metadata. `virtual_gifts` is the separate MXM ownership layer.

```text
verified Telegram Gift
        ↓
gift_assets
        ↓
virtual_gifts
        ↓
listing / offers / trades
        ↓
virtual TON ledger
```

## Offline liquidity

A bounded NPC liquidity engine can create virtual listings only for unused, verified `gift_assets` rows. NPC/system profiles are marked `is_system`, excluded from leaderboards and auditable through `npc_market_log`.

NPC pricing can use Telegram trait rarity plus MXM collection observations, but it never changes Telegram metadata. Market page refills are DB-only and never wait on an external Telegram request.

## Market read path

The initial Gift Market response is intentionally bounded. Heavy source fields such as raw Telegram payloads are excluded via `giftMarketSelect`.

For search queries of two or more characters, `/api/market/search` performs a lazy server-side search across active listings by collection/model/backdrop/symbol or exact Gift number. This keeps first paint fast without limiting search to the initial cards.

Supabase Realtime is an invalidation signal only. After a market event, the client refetches authoritative server state.

## Gift purchase paths

### Buy Now

`buy_virtual_gift` is the single-item transactional purchase path.

### Cart

`market_cart_items` stores the server-side cart. `buy_virtual_gift_cart`:

- accepts 1–20 unique Gift IDs;
- locks buyer/listings/sellers in deterministic order;
- revalidates current listing state;
- accounts for reserved pending offers;
- debits the buyer once;
- transfers all Gifts or none;
- pays sellers;
- rejects superseded offers;
- records trades/candles/missions;
- removes purchased Gifts from every stale cart.

The client cannot provide authoritative owner, balance or price values.

## Gift details

The Gift detail API returns:

- current listing and best offer;
- collection + trait floors;
- recent completed sales;
- latest collection candles;
- item all-time trade count/volume/high/low sale;
- current cart state.

In-app navigation is intercepted by `app/@modal/(.)gifts/[id]`, so Gift details open as a bottom sheet. Direct/shared URLs still resolve to the standalone Gift page.

## Memecoins

Memecoins use server-side AMM/RPC trading. Quotes are calculated from authoritative reserves before trade confirmation. User coin images are validated and stored server-side. Candles are derived from completed MXM trades only.

## Local control

`/control` is restricted to localhost/loopback and uses a generated `.mxm-control-secret`. The panel can manage users, balances, bans, leaderboard visibility, missions, coins, catalogue sources, Gift ownership/listings and audit data.
