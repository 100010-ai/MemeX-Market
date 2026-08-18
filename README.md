# MemeX Market (MXM) v0.7.0

Telegram Mini App for a multiplayer simulated market built with **Next.js, TypeScript, Tailwind CSS, Supabase and Vercel**.

MXM has two connected markets:

- **Coins** — player-created meme coins with server-side AMM trading, positions, OHLC candles, volume, holders and market cap.
- **Gifts** — MXM ownership/trading around exact metadata and media synced from Telegram Unique Gifts. The collectible in Telegram is never transferred by MXM.

A new profile starts with **$100 MXM cash**. There are no seeded market assets, generated Gift media, synthetic listings, browser dev accounts or demo prices.




## v0.7 — Global Gift Market, performance, coin media and local God Mode

- **Global virtual Telegram Gift market:** player ownership in Telegram is no longer required for the main market. Real Telegram Gift metadata/media is imported into system inventory from `MARKET_CATALOG_TELEGRAM_IDS`, while ownership, listings, offers and trades inside MXM remain virtual.
- **No market-data fallbacks:** no fake Gifts, prices, trades, candles, rankings or activity are generated. Empty/error states stay empty/error states.
- **Much faster market path:** Gifts and Coins load independently, the mobile market no longer blocks on the expensive live-feed query, real market responses are briefly reused client-side then revalidated, Realtime refreshes are debounced, and the heavy market/portfolio SQL views were rewritten around grouped aggregates instead of repeated per-row subqueries.
- **Telegram Gift media:** compact cards prefer real Telegram thumbnails, media loads only near the viewport, TGS is not booted for every off-screen card, Telegram file metadata is cached, file responses are streamed instead of buffered, and media authorization no longer performs a profile DB query for every image.
- **Memecoin images:** users can upload PNG/JPEG/WebP logos (max 2 MB). The client scales the real selected image down to max 512 px for a lighter market avatar; the server still verifies MIME + magic bytes and stores it in Supabase Storage.
- **Mobile UI:** Gift filters are one horizontally swipeable rail again; native selects were replaced with smooth bottom-sheet selectors; Portfolio and Orders tabs also scroll horizontally instead of squeezing/wrapping; typography and surfaces remain compact/dark/rounded.
- **Russian tasks:** existing gameplay missions are localized in the migration; the old personal Gift-sync mission is disabled because sync is not required to trade.
- **Security:** shorter Telegram initData acceptance window, active-ban enforcement, same-origin checks for mutations, DB-backed rate limits, reserved-balance checks, server-only financial mutations, security headers, and admin audit logging.
- **Local God Mode:** `/control` works only on loopback `localhost`/`127.0.0.1`, only when explicitly enabled, and requires a signed HttpOnly local session. It loads the complete control datasets in pages and can modify balances and XP, ban/unban, hide/unhide players from leaderboards, create/edit/delete tasks, create/hide/stop/delete memecoins, upload coin images, sync the real Telegram catalog, list/unlist Gifts, transfer virtual Gift ownership, inspect the complete audit stream and explicitly sign out.

### Upgrade database

If the project already has migrations through `006_market_drops.sql`, run only:

```text
supabase/migrations/007_v07_control_performance.sql
```

If `006_market_drops.sql` was never applied, apply `006` first and then `007`. `007` is defensive about `profiles.is_system`, but `006` also contains the global catalog bootstrap behavior.

### Local control panel

Create `.env.local` from `.env.example` and set at minimum:

```text
MXM_LOCAL_ADMIN_ENABLED=true
MXM_LOCAL_ADMIN_TOKEN=<long random local token>
SESSION_SECRET=<32+ character random secret>
```

Run `npm run dev` and open `http://localhost:3000/control`. The route deliberately returns unavailable for non-loopback requests, including a normal Vercel domain. Do **not** configure the local God Mode variables in Vercel Production.

## v0.6.2 — Mobile UI hotfix

- Исправлена сломанная вкладочная панель портфеля: счётчики больше не переносятся на вторую строку, длинные подписи сокращены и не ломают сетку на узком Telegram WebView.
- Исправлены мобильные отступы и прокрутка: страница имеет корректный нижний запас под fixed navigation, горизонтальные rails получили touch scrolling, а фильтры Gifts больше не требуют горизонтальной прокрутки — на телефоне они складываются в две колонки.
- Убран лишний набор кнопок из мобильного header: остались только профиль и баланс.
- Убран пользовательский UI синхронизации Telegram Gifts из профиля и портфеля. Backend sync/diagnostics сохранён для служебного импорта, но игровой интерфейс больше не заставляет игрока владеть подарком в Telegram.
- Уменьшена типографика на мобильных экранах, отключено автоматическое увеличение текста WebView.
- Акцентный цвет заменён с ярко-жёлтого на приглушённый золотой `#c6aa58`.
- Фон затемнён до `#050607`, поверхности и активные элементы сделаны мягче и более скруглёнными.
- `/api/health` сообщает версию `0.6.2`.
- Изменений схемы Supabase в v0.6.2 нет. Если база уже обновлена до v0.6.1, SQL запускать не нужно.

## v0.6.1 — Russian UI + Realtime config fix

- Интерфейс переведён на русский язык: маркет, торговля, портфель, задания, рейтинг, профили, офферы и диагностика.
- Визуальная система стала темнее и мягче: более глубокий фон, скруглённые поверхности, кнопки, фильтры, карточки и нижняя навигация.
- Supabase Realtime больше не является причиной падения всего Mini App. Конфигурация Realtime запрашивается через серверный `/api/realtime/config`.
- Для Realtime принимаются `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` или `SUPABASE_ANON_KEY`. URL берётся из `NEXT_PUBLIC_SUPABASE_URL` либо `SUPABASE_URL`.
- Если публичный ключ Realtime действительно не задан, основной серверный API продолжает показывать реальные данные Supabase; Realtime просто не запускается. Никакого polling, mock/fake market data или подстановки активов нет.
- `/api/health` теперь сообщает `realtimeConfigured` и версию `0.6.1`.
- Тексты заданий в базе переводятся миграцией `005_v061_ru_ui.sql`.

### Обновление с v0.6

Выполните только:

```text
supabase/migrations/005_v061_ru_ui.sql
```

Кодовую миграцию Realtime применять в Supabase не требуется — это исправление Next.js/Vercel-конфигурации.

## v0.5 — Real Market Core

- Strict Telegram Gift sync with a persisted diagnostics run for every attempt.
- Gift sync validates Telegram identity, number, model, symbol, backdrop, rarity, sticker identity, dimensions and media kind before upsert.
- Model + symbol media are rendered from Telegram file IDs; backdrop colors come from Telegram metadata.
- Burned Gifts are made non-tradeable and any open listing/offers are closed.
- Gift collection candles are rebuilt from completed MXM Gift sales and then maintained at one-minute OHLC resolution.
- Gift market cards expose live offer depth and use only actual listings/market observations.
- Pending Gift offers reserve MXM cash. Coin buys, coin launches, Gift buys and new offers can spend only the remaining available balance.
- Gift RPCs reject burned assets and keep ownership/balance changes transactional.
- Gift detail UI now includes collection/model/backdrop/symbol floors, offers, activity and price history.
- Market UI is denser and closer to a Telegram-native marketplace: compact filters, sorting, Gift grid, collection stats and live feed.
- Leaderboard now has Overall, total realized PnL, Gift PnL, Coin PnL, collection value and creator market-cap boards.
- Vault/Profile expose available vs reserved balance and detailed Telegram Gift sync results.
- Gift offer changes publish a public-safe `market_events` invalidation while private `gift_offers` rows stay server-only.
- Added private `/admin` diagnostics for Telegram Gift source health and sync failures.
- Added more event-driven daily/weekly Gift missions.

## Upgrading an existing MXM database

### From v0.4.1

Run only:

```text
supabase/migrations/003_v05_real_market_core.sql
supabase/migrations/004_v06_exchange_retention.sql
supabase/migrations/005_v061_ru_ui.sql
supabase/migrations/006_market_drops.sql
supabase/migrations/007_v07_control_performance.sql
```

### From the old v0.2 schema

Run, in order:

```text
supabase/migrations/002_remove_legacy_placeholders.sql
supabase/migrations/003_v05_real_market_core.sql
supabase/migrations/004_v06_exchange_retention.sql
supabase/migrations/005_v061_ru_ui.sql
supabase/migrations/006_market_drops.sql
supabase/migrations/007_v07_control_performance.sql
```

If an old attempt at `002_remove_legacy_placeholders.sql` failed on a dependent view, use the corrected `002` included here and run it from the beginning. Its transaction rolls back a failed attempt instead of leaving a half-migrated schema.

### Fresh Supabase project

Run all migrations in order:

```text
supabase/migrations/001_init.sql
supabase/migrations/002_remove_legacy_placeholders.sql
supabase/migrations/003_v05_real_market_core.sql
supabase/migrations/004_v06_exchange_retention.sql
supabase/migrations/005_v061_ru_ui.sql
supabase/migrations/006_market_drops.sql
supabase/migrations/007_v07_control_performance.sql
```

`supabase/seed.sql` intentionally inserts **no market assets**.

## 1. Requirements

- Node.js 20.9+.
- A Supabase project.
- A Telegram bot, e.g. `@MemeXMarketBot`.
- A Vercel project connected to the repository.

## 2. Environment

Copy `.env.example` to `.env.local` locally, and configure the same values in Vercel:

```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# Optional compatibility aliases:
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
TELEGRAM_BOT_TOKEN=123456789:AA...
SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-characters
NEXT_PUBLIC_APP_NAME=MemeX Market
ADMIN_TELEGRAM_IDS=123456789
```

`SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN` and `SESSION_SECRET` are server-only. `ADMIN_TELEGRAM_IDS` is optional; when unset, `/admin` is unavailable to everyone.

## 3. Install and run

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

The authenticated app must be opened from Telegram. There is deliberately no fake browser login route.

## 4. BotFather setup

1. Create/configure `@MemeXMarketBot` in BotFather.
2. Deploy the Next.js project to Vercel.
3. Set the bot's Mini App/menu-button URL to the Vercel HTTPS URL.
4. Open MXM from the bot inside Telegram.

The app posts Telegram `initData` to `/api/auth/telegram`. The server validates it, updates the profile in Supabase and issues a signed HTTP-only session cookie.

## 5. Telegram Gift pipeline

`POST /api/gifts/sync` performs a strict paginated sync.

For every Telegram Unique Gift it requires and stores:

- Telegram `gift_id`, unique `name`, base/collection name and number;
- model name, rarity, file ID, thumbnail and static/animated/video flags;
- symbol name, rarity, file ID, thumbnail and static/animated/video flags;
- backdrop name, rarity and Telegram colors;
- premium/burned/blockchain flags;
- the observed Telegram Gift payload for diagnostics;
- `last_seen_at`.

Each run is written to `gift_sync_runs` with page counts, Telegram totals, imported/updated counts and the exact failure message if the sync fails.

Telegram media is proxied only after the file ID is known to `gift_assets`:

```text
/api/telegram/file/[fileId]
/api/telegram/tgs/[fileId]
```

If required Telegram source data is missing or inconsistent, sync fails. MXM does not invent replacement artwork or Gift metadata.

## 6. Market transaction model

### Cash reservation

Pending Gift offers reserve cash. The profile has:

- `balance` — total MXM cash;
- `reservedBalance` — sum of pending Gift offers;
- `availableBalance` — spendable cash after reservations.

The database RPCs enforce this server-side for:

- Coin buys;
- Coin launch fee;
- Gift Buy Now;
- Gift offers.

### Gift market

- listing/unlisting: `list_virtual_gift`;
- Buy Now: `buy_virtual_gift`;
- offer/update offer: `create_gift_offer`;
- accept/reject: `resolve_gift_offer`;
- cancel own offer: `cancel_gift_offer`.

Completed sales update ownership, balances, realized PnL, missions, market activity and Gift collection candles inside Postgres.

### Coin market

Coins use a constant-product AMM. Buy/sell mutations are server RPCs and completed trades update holdings, market state and minute OHLC candles.

## 7. Main routes

```text
/market              Gifts + Coins market
/gifts/[id]          Gift details / trade / offers / activity / chart
/coin/[id]           Coin candles / buy / sell / holders
/create               Launch a meme coin
/orders               Incoming/outgoing Gift offers + listings
/hub                  Live market feed
/tasks                Onboarding / daily / weekly missions
/vault                Net worth / holdings / Gifts / listings / history
/leaderboard          Six global ranking boards
/profile              Current Telegram profile + Gift sync
/u/[id]               Public player profile
/admin                 Private diagnostics, gated by ADMIN_TELEGRAM_IDS
```

## 8. Realtime

The client uses Supabase Realtime as an invalidation signal for market-facing changes, including:

- `coins`
- `trades`
- `virtual_gifts`
- `gift_trades`
- `market_events` (including public-safe Gift offer invalidation)

`gift_offers` is deliberately not exposed through public Realtime. Offer create/cancel/reject writes an `offer` event to `market_events`; completed offer purchases also emit the normal ownership/trade changes. After an event the page refetches its server API contract. Realtime data is never trusted as the authoritative balance/ownership state.

## 9. Economy in this build

- New account: **$100**.
- Coin launch: **$50**.
- Coin trading fee: **0.5%**.
- Coin supply: **1,000,000,000**.
- Gift/coin market prices only change from player market activity.
- Gift `estimatedValue` only uses available MXM observations (collection/trait floors and collection last sale). With no observations it remains `NULL`/Unpriced.
- Burned Telegram Gifts cannot be listed, offered on, bought or counted as active Gift portfolio value.

## 10. Diagnostics

Set your Telegram numeric ID in `ADMIN_TELEGRAM_IDS` and open `/admin` inside the Mini App.

Diagnostics show:

- player count;
- Telegram Gift asset count;
- active/burned/missing-media source counts;
- listings and pending offers;
- Gift/Coin trade counts;
- latest 20 Telegram Gift sync runs and exact errors.

The diagnostics table is server-only behind RLS and is read with the Supabase server credential.

## 11. Project layout

```text
app/                    Next.js App Router UI + API routes
components/             MXM shell, Gift media/cards, chart, realtime
lib/                    Telegram auth/sync, Supabase, mapping, feed
supabase/migrations/    schema + v0.4 cleanup + v0.5 market core
docs/                   architecture + database upgrade notes
supabase/seed.sql       intentionally contains no market data
```
