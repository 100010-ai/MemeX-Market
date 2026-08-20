# MXM v0.46

## Исторический порядок обновления

1. Применить `supabase/migrations/021_v046_stars_referrals_market_polish.sql` после миграции 020.
2. Настроить `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.
3. Направить Telegram Bot API webhook на `https://<domain>/api/telegram/webhook` с тем же secret token.
4. Для быстрого расширения NFT-каталога рекомендуется `TONAPI_KEY`; без ключа действует публичный лимит.

## Что изменилось

- Telegram Stars → виртуальные TON.
- Реферальная программа от системных наград.
- Более полный и постепенно расширяемый Telegram Gifts каталог.
- Полные словари фильтров и догрузка результатов.
- Улучшенные ордера/офферы и быстрое снятие листинга.
- Share для мемкоинов, gesture close для modal/sheet экранов.
- Мобильная FPS/animation оптимизация и сетевой request dedupe.
- Исправлен Gift detail с длинным `ton:` идентификатором.

Устаревшая рекламная механика v0.46 удалена Market 2.0 и не должна настраиваться в новых окружениях.
