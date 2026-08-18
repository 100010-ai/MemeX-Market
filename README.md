# MemeX Market (MXM) v0.8.0

**MemeX Market** — Telegram Mini App с двумя связанными виртуальными рынками:

- **Telegram Gifts** — реальные collectible Gifts из Telegram используются как проверенные визуальные/metadata-ассеты, а владелец, листинг, офферы, сделки и PnL внутри MXM существуют отдельно и полностью виртуальны.
- **Мемкоины** — создаются игроками и торгуются через серверный AMM с реальными для MXM сделками, котировками, позициями и свечами.

Базовая игровая валюта — **виртуальный TON**. Новый профиль получает **100 виртуальных TON**. Это не настоящий TON, не криптовалюта на блокчейне, не выводится и не обменивается на реальные активы.

В активном продукте нет demo/mock/fake market data, случайных цен, сгенерированных свечей, фейковых пользователей или запасных NFT-картинок. Если источник недоступен или данных нет, интерфейс показывает loading/empty/error state.

## v0.8 — Global Telegram Resale + Virtual TON

### Глобальный каталог Telegram Gifts

Главный Gift Market больше не зависит от `MARKET_CATALOG_TELEGRAM_IDS` и не требует, чтобы игрок владел Gift в своём Telegram.

Сервер использует MTProto user session:

1. получает реальные базовые Telegram Gift types;
2. выбирает только/прежде всего типы с resale inventory;
3. ежедневно ротирует порядок коллекций;
4. проверяет ограниченное число коллекций, а не весь каталог;
5. получает реальные unique Gifts, которые сейчас присутствуют в Telegram resale;
6. принимает только Gifts с точным slug, номером, model/symbol/backdrop, rarity, Telegram media identity и реальной TON resale price;
7. зеркалирует реальные Telegram media в Supabase Storage;
8. создаёт отдельный виртуальный MXM instance, если его ещё нет;
9. стартовый виртуальный listing получает цену, наблюдавшуюся в Telegram resale в TON в момент импорта.

После появления Gift в MXM Telegram ownership и MXM ownership полностью независимы. Сделка внутри MXM **не покупает, не передаёт и не изменяет настоящий Telegram Gift**.

### Как первый игрок не попадает в пустой рынок

Вместо seed/demo данных используется ограниченный bootstrap реального Telegram resale:

- целевой минимум по умолчанию: `12` активных Gift listings — достаточно, чтобы первый экран не был пустым, но initial bootstrap не тащил лишние media;
- при абсолютно пустом рынке сервер может проверить до `32` реальных Gift collections, но импортирует только нужное небольшое количество;
- из одной коллекции берётся максимум `4` подходящих unique Gifts;
- для первоначальной доступности новым игрокам по умолчанию импортируются Gifts с наблюдавшейся resale price не выше `95 TON`;
- рынок сортирует Telegram resale по цене, поэтому bootstrap старается наполнить стартовый рынок доступными реальными collectible Gifts;
- после появления достаточной виртуальной ликвидности повторный bootstrap не запускается на каждом запросе.

Если Telegram/MTProto не настроен или Telegram не вернул подходящие реальные Gifts, MXM **не генерирует замену**.

### Производительность каталога

- Global sync защищён Postgres lock, поэтому несколько инстансов не запускают один и тот же импорт параллельно.
- Статус и ошибки сохраняются в `catalog_sync_runs` / `catalog_sync_state`.
- Одинаковые model/symbol media внутри одного sync переиспользуются через in-memory cache.
- Storage path строится по Telegram unique file identity, поэтому одинаковые media не дублируются для каждого Gift.
- model и symbol одного Gift зеркалируются параллельно.
- Market API автоматически делает bootstrap только когда Gift Market действительно пуст.

## Горизонтальные вкладки и фильтры

Все длинные мобильные rails сделаны реальным horizontal swipe-контейнером:

- Gift filters: `Коллекция / Модель / Фон / Символ / Цена / Сортировка`;
- категории мемкоинов;
- Portfolio tabs;
- Orders tabs;
- Leaderboard tabs;
- trait tabs коллекций;
- Gift detail tabs;
- Hub quick actions;
- административные market rails.

Корневая причина старой проблемы была в `touch-action` на `body`, который мешал горизонтальному жесту в Telegram WebView. В v0.8 `body` разрешает жесты, а `.mxm-hscroll` имеет `overflow-x:auto`, `flex-wrap:nowrap`, `flex-shrink:0`, momentum scrolling и скрытый scrollbar. Элементы не переносятся и не обрезаются без возможности свайпа.

## Мемкоины

- Создание мемкоина — реальная серверная операция.
- Launch fee: **50 виртуальных TON**.
- Можно загрузить свою PNG/JPEG/WebP картинку.
- Клиент уменьшает выбранное изображение до разумного размера, сервер повторно валидирует MIME/magic bytes.
- Изображение хранится в Supabase Storage.
- Buy/Sell использует серверный quote: amount out, execution price, fee и price impact.
- Свечи строятся только из завершённых MXM trades.
- Если сделок недостаточно, fake candles не создаются.

## Задания

Задания хранятся в Supabase и отображаются на русском. Progress/reward/status берутся с backend. Старое обязательное задание на синхронизацию собственной Telegram Gift-коллекции отключено: владение реальным Gift не требуется для торговли.

## Безопасность

- Telegram `initData` проверяется сервером.
- Активный бан проверяется при авторизации/операциях.
- Финансовому состоянию клиента нельзя доверять: balance, ownership, quote, price, reserved balance и PnL проверяются сервером/SQL RPC.
- Gift buy/list/offer/resolve выполняются транзакционно.
- Pending offers резервируют виртуальный TON.
- Mutating routes имеют same-origin protection и DB-backed rate limiting.
- Критичные операции защищены от двойного расходования состоянием БД.
- Server secrets не имеют `NEXT_PUBLIC_` префикса.
- Добавлены security headers.
- Локальная God Mode пишет audit log.

## Локальная God Mode админка

`/control` предназначена только для локального управления и не должна открываться на production domain.

Она позволяет:

- видеть игроков и их баланс/XP;
- устанавливать или изменять баланс виртуального TON;
- банить и разбанивать;
- скрывать/возвращать любого игрока в leaderboard, включая администратора;
- создавать, включать, выключать и удалять задания;
- создавать/останавливать/скрывать/удалять мемкоины;
- задавать creator и изображения коинов;
- вручную запускать Global Telegram Resale sync;
- видеть статус/ошибки global catalog sync;
- видеть Telegram resale source и observed TON price у Gift;
- листить/снимать/передавать виртуальный Gift;
- читать полный admin audit.

## Supabase migration

### Если уже установлен v0.7

Запустить только:

```text
supabase/migrations/008_v08_global_resale_virtual_ton.sql
```

### Fresh database

```text
supabase/migrations/001_init.sql
supabase/migrations/002_remove_legacy_placeholders.sql
supabase/migrations/003_v05_real_market_core.sql
supabase/migrations/004_v06_exchange_retention.sql
supabase/migrations/005_v061_ru_ui.sql
supabase/migrations/006_market_drops.sql
supabase/migrations/007_v07_control_performance.sql
supabase/migrations/008_v08_global_resale_virtual_ton.sql
```

`supabase/seed.sql` не должен содержать рыночные активы.

## Environment

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

TELEGRAM_BOT_TOKEN=123456789:AA...
SESSION_SECRET=replace-with-a-random-secret-at-least-32-characters

# MTProto user session for global Telegram resale catalogue
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
TELEGRAM_USER_SESSION=replace-with-exported-mtcute-session

# Bounded real-catalog bootstrap/rotation
MARKET_BOOTSTRAP_MIN_LISTINGS=12
MARKET_CATALOG_TARGET_LISTINGS=36
MARKET_CATALOG_COLLECTIONS_PER_SYNC=12
MARKET_BOOTSTRAP_SCAN_COLLECTIONS=32
MARKET_CATALOG_ITEMS_PER_COLLECTION=4
MARKET_BOOTSTRAP_MAX_PRICE_TON=95

ADMIN_TELEGRAM_IDS=123456789

# Local machine only
MXM_LOCAL_ADMIN_ENABLED=true
MXM_LOCAL_ADMIN_TOKEN=replace-with-a-long-local-token-minimum-24-characters
```

`TELEGRAM_USER_SESSION`, `TELEGRAM_API_HASH`, `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `SESSION_SECRET` и `MXM_LOCAL_ADMIN_TOKEN` — server-only secrets.

`MARKET_CATALOG_TELEGRAM_IDS` в v0.8 больше не используется.

## Создание Telegram user session

Global resale API требует авторизованную Telegram user session, поэтому одного Bot Token недостаточно.

1. Получи `TELEGRAM_API_ID` и `TELEGRAM_API_HASH` для своего Telegram API application.
2. Локально задай эти две переменные.
3. Выполни:

```bash
npm run telegram:session
```

4. Скрипт попросит телефон, код Telegram и при необходимости 2FA password.
5. Полученную длинную строку сохрани как `TELEGRAM_USER_SESSION` в server environment.

Никогда не публикуй эту строку: она даёт доступ к авторизованной Telegram session.

## Локальный запуск

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

God Mode:

```text
http://localhost:3000/control
```

Для production не включай `MXM_LOCAL_ADMIN_ENABLED`.

## Основные маршруты

```text
/market                 Gifts + Memecoins
/gifts/[id]             Gift details / offers / activity / chart
/collections/[name]     Gift collection
/coin/[id]              Memecoin trading
/create                  Create memecoin + custom image
/orders                  Offers and listings
/hub                     Market activity
/tasks                   Russian missions
/vault                   Portfolio
/leaderboard             Rankings
/profile                 Telegram profile
/u/[id]                  Public player profile
/admin                   In-app diagnostics admin
/control                 Loopback-only God Mode
```

## Принцип данных

**Допустимо:** loading skeleton, empty state, error state, retry.

**Недопустимо:** fake Gift, emoji вместо media, случайная цена, synthetic candle, sample user, demo trade, generated activity, hardcoded portfolio или клиентский баланс как источник истины.
