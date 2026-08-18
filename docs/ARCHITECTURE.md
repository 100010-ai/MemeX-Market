# MXM v0.8 Architecture

## 1. Два независимых слоя Telegram Gift

### Telegram source asset

`gift_assets` хранит проверенное описание реально существующего collectible Gift:

- Telegram slug / base gift id / number;
- collection title;
- model / symbol / backdrop;
- rarity per mille;
- Telegram file identities;
- mirrored model/symbol media URLs;
- raw normalized Telegram source payload;
- catalog source;
- observed Telegram resale TON price and timestamp.

### MXM virtual instance

`virtual_gifts` хранит только игровое состояние:

- MXM owner;
- acquired price;
- listing price/status;
- last sale;
- timestamps.

`gift_offers`, `gift_trades`, `gift_collection_candles` продолжают виртуальный lifecycle. Настоящий Telegram owner не меняется при сделке MXM.

## 2. Telegram Bot API catalogue ingestion

Основной source v0.8 — Telegram global resale via Bot API user session.

Pipeline:

```text
Telegram getStarGiftOptions
        ↓
bounded daily rotation of base Gift types
        ↓
Telegram getStarGiftResaleOptions(sort=price)
        ↓
strict validation of exact collectible metadata + TON resale price
        ↓
mirror genuine Telegram model/symbol media to Supabase Storage
        ↓
gift_assets upsert
        ↓
seed_global_catalog_gift()
        ↓
small system-owned virtual MXM listing
```

Каталог реальных Unique Gifts импортируется через Telegram Bot API из источников, настроенных в локальном `/control`. Production-запросы рынка не выполняют внешнее сканирование Telegram: DB-only NPC liquidity tick использует только уже проверенные `gift_assets`.

## 3. Bootstrap первого пользователя

`GET /api/market?scope=gifts` сначала читает текущий рынок. При низкой ликвидности выполняется короткий `ensureNpcMarketLiquidity()` без внешних HTTP-запросов; он может создать listings только из `bot_catalog` assets.

Postgres advisory-style state lock через `catalog_sync_state` не позволяет нескольким serverless requests одновременно запускать импорт. После sync Market выполняет новый authoritative query.

Если sync не удался, API не вставляет альтернативные данные.

## 4. Virtual TON

`profiles.balance` остаётся numeric ledger, но продуктовая единица v0.8 — **virtual TON**.

- signup: 100 virtual TON;
- memecoin launch: 50 virtual TON;
- Gift listing/offers/trades: virtual TON;
- memecoin AMM reserves/quotes/trades: virtual TON;
- portfolio/net worth/PnL/leaderboard: virtual TON.

Это внутренняя игровая единица с TON denomination. Она не является настоящим on-chain TON и не имеет redemption flow.

## 5. Транзакции и баланс

Client не является source of truth.

Gift buy/list/offer/resolve и coin buy/sell/create завершаются серверно/SQL RPC. Pending Gift offers входят в `reservedBalance`; spendable amount вычисляется как available balance после reservations.

Database locking/state guards предотвращают повторную продажу одного instance и расход уже зарезервированного баланса.

## 6. Realtime

Supabase Realtime используется как invalidation signal, а не как authoritative financial state.

После события UI повторно запрашивает backend contract. `gift_offers` остаются private; публичное изменение офферов инвалидируется через `market_events`.

## 7. Media performance

- cards lazy-load Gift media;
- static thumbnail используется там, где Telegram его дал;
- TGS запускается только у видимого/близкого к viewport media;
- Telegram file proxy stream-ит response;
- global Bot API importer зеркалирует media по Telegram unique file identity;
- одинаковые media переиспользуются во время одного sync;
- model/symbol одного Gift скачиваются параллельно.

## 8. Horizontal mobile rails

`.mxm-hscroll` — единый primitive для длинных mobile tabs/filters.

Он использует:

```text
flex-wrap: nowrap
overflow-x: auto
children: flex: 0 0 auto
white-space: nowrap
-webkit-overflow-scrolling: touch
```

`body` не блокирует horizontal pan. Это важно для Telegram WebView.

## 9. Local God Mode

`/control` доступен только в development на loopback host. При первом открытии сервер создаёт `.mxm-control-secret`; после token-auth используется signed HttpOnly + SameSite Strict session. Все mutations идут через server routes и пишутся в audit log.

God Mode не должен быть включён на production Vercel environment.
