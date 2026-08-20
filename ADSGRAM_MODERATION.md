# AdsGram moderation — MXM v0.50

Эта версия подготовлена так, чтобы рекламная интеграция была отдельной **добровольной** механикой, а не способом блокировать основной продукт.

## Что изменено в MXM

- Rewarded-реклама запускается только по отдельной кнопке пользователя.
- Основные функции MXM работают без просмотра рекламы.
- Клик по самому объявлению не нужен для начисления внутриигровой награды.
- Серверное начисление использует Reward URL и не доверяет браузеру в production.
- Рекламная награда снижена до **1 игрового TON**, максимум **3 просмотра в сутки**, cooldown 30 минут.
- В интерфейсе явно написано, что игровой TON — не Toncoin, не выводится и не имеет денежной стоимости.
- Пользовательские/партнёрские задания на подписки и переходы отключены по умолчанию (`ENABLE_SPONSORED_TASKS=false`). Активные кампании ставятся на паузу миграцией `025_v050_adsgram_moderation.sql`.
- Добавлен экран `/about` с правилами продукта и рекламных наград.
- Добавлен публичный `/moderation` с краткой информацией для модератора.
- Добавлен публичный `/reward-confirmations`: он показывает только реальные серверно подтверждённые AdsGram-начисления и не создаёт фейковые записи.
- AdsGram SDK используется без debug-режима в production.

## AdsGram Platform

Не придумывайте данные площадки. Скопируйте их из BotFather:

1. **Telegram direct link** — BotFather → `/myapps`.
2. **Web app URL** — BotFather → `/myapps`.
3. **Bot ID** — BotFather → `/mybots` → API Token; Bot ID — цифры до `:`.
4. В AdsGram эти значения должны совпадать с BotFather **точно**.

## Ad unit

Создайте блок типа **Reward**. После создания скопируйте числовой `BlockID` в:

```env
NEXT_PUBLIC_ADSGRAM_BLOCK_ID=123456
```

Reward URL должен иметь форму:

```text
https://YOUR_DOMAIN/api/rewards/ads/adsgram?userid=[userId]&token=YOUR_SECRET
```

`[userId]` оставляется буквально — AdsGram заменит его Telegram ID пользователя.

Проверить готовую production-конфигурацию:

```bash
npm run adsgram:check
```

Скрипт выведет готовый Reward URL для вставки в кабинет AdsGram.

## Перед отправкой на модерацию

- Mini App открывается из Telegram на мобильном и desktop-клиенте.
- Маркет, портфель, профиль и задания работают без просмотра рекламы.
- Нажатие `Смотреть рекламу` — единственный способ запустить rewarded-показ; автопоказа нет.
- Пользователь может просто не смотреть рекламу и продолжить работу.
- `ENABLE_SPONSORED_TASKS=false`.
- Rewarded reward = 1 игровой TON; daily limit = 3.
- В production нет `debug: true`.
- Reward URL отвечает по HTTPS/443.
- `NEXT_PUBLIC_APP_URL` соответствует production Web App URL.
- В AdsGram переданы корректные Telegram direct link, Web App URL и Bot ID.
- `/reward-confirmations` доступен без Telegram-авторизации; перед модерацией выполнен хотя бы один реальный rewarded-показ, чтобы в истории было проверяемое начисление.
- `/moderation` доступен по production Web App URL и содержит прямые ссылки на бота, правила и подтверждения наград.

Для модерации AdsGram просит ссылку на platform вида `https://partner.adsgram.ai/platforms/xxx/` и пересланное сообщение BotFather с Telegram direct link + Web App URL.

Официальная документация:

- https://docs.adsgram.ai/publisher/get-block-id
- https://docs.adsgram.ai/publisher/reward-interstitial-integration
- https://docs.adsgram.ai/publisher/troubleshooting
