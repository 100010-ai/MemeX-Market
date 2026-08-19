# MXM v0.46

## Перед деплоем

1. Применить `supabase/migrations/021_v046_stars_referrals_market_polish.sql` после миграции 020.
2. Убедиться, что настроены `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.
3. Направить Telegram Bot API webhook на `https://<domain>/api/telegram/webhook` и передать тот же secret token.
4. Для рекламы оставить настроенными `NEXT_PUBLIC_ADSGRAM_BLOCK_ID` и `ADSGRAM_REWARD_SECRET`.
5. Для быстрого расширения NFT каталога рекомендуется `TONAPI_KEY`; без ключа используется более медленный публичный лимит.

## Что изменилось

- Telegram Stars → виртуальные TON.
- Реферальная программа 5% от системных наград.
- Rewarded ads до 5/сутки.
- Более полный и постепенно расширяемый Telegram Gifts каталог.
- Полные словари фильтров и догрузка результатов фильтра.
- Улучшенные ордера/офферы и быстрое снятие листинга.
- Share для мемкоинов.
- Gesture close для основных modal/sheet экранов.
- Мобильная FPS/animation оптимизация и сетевой request dedupe.
- Исправлен Gift detail с длинным `ton:` идентификатором.
