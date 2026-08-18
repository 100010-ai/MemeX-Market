# MemeX Market (MXM) v0.9.0

Telegram Mini App for a multiplayer simulated market built with Next.js, TypeScript, Supabase/Postgres and Vercel.

MXM uses **virtual TON only**. Telegram collectible Gifts provide real source artwork/metadata, while ownership, listings, offers, trades and PnL inside MXM are simulated and never transfer the real Telegram collectible.

## v0.9 — Market Flow

This release tightens the marketplace flow around the interaction patterns of mature Telegram gift markets without cloning their branding or relying on demo data.

- Added a **server-side Gift cart**. Cart contents live in Postgres, not localStorage.
- Added atomic multi-item checkout with row locking, balance/reservation validation and all-or-nothing purchase semantics.
- Market Gift cards can add/remove a live listing from the cart without opening the detail page.
- Gift search is now **lazy and server-backed**: the first Market payload stays bounded, while queries of 2+ characters search across active listings by collection, model, backdrop, symbol or exact Gift number.
- Added `/cart` with live listing validation, stale-item cleanup, total virtual TON cost and one-tap checkout.
- Added compact Gift discovery rails: `Все`, `Выгодно`, `Редкие`, `Новые`, `С офферами`.
- All long filters/tabs continue using the shared horizontal swipe rail for Telegram WebView.
- Mobile Market is denser: collection overview cards are no longer inserted above the mobile catalog.
- Bottom navigation now calls the asset area **Хранилище**.
- Hub mobile UI has separate horizontally swipeable `Лента рынка / Топ трейдеров` sections instead of forcing two large blocks at once.
- Gift detail now supports add/remove from cart alongside Buy Now and offers.
- Gift detail exposes item-level all-time trade count, all-time virtual TON volume, high/low sale and a dedicated activity feed.
- Gift/collection chart payloads were cut from 4000 old minute rows to the latest 1200 rows, reducing response size and fixing the chart to show recent history rather than the oldest buckets.
- Gift API queries no longer fetch `telegram_payload` and other unused heavy source fields on every market/portfolio request. `giftMarketSelect` requests only fields needed by the UI.
- NPC liquidity candidate selection is diversified across collections instead of exhausting one collection first.
- NPC listings remain based only on previously verified Telegram Gift assets; no NFT metadata is generated.
- Market bootstrap target was increased slightly so a fresh player has a broader initial selection while the UI still shows a bounded catalog rather than the entire source database.

## Database upgrade

If the database already has `009_v081_npc_liquidity.sql`, run only:

```text
supabase/migrations/010_v09_mrkt_flow.sql
```

The migration adds:

- `market_cart_items`;
- transactional `buy_virtual_gift_cart(...)`;
- diversified `npc_market_candidates(...)`.

It inserts no demo market assets.

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

NPCs never create Telegram NFT metadata. They can only virtualize rows already verified and stored in `gift_assets`.

```text
verified Telegram Gift metadata
        ↓
gift_assets
        ↓
diversified NPC liquidity
        ↓
virtual TON listings
        ↓
players / cart / offers / secondary market
```

When system liquidity falls below the target, the backend performs a bounded DB-only refill. It does not call an external Telegram source while the user is waiting for the Market page.

## Build

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

The authenticated application is intended to be opened through Telegram because server authentication validates Telegram `initData`.
