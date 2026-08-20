# MXM v0.46 — Telegram Stars и рефералы

## Telegram Stars

1. Применить `supabase/migrations/021_v046_stars_referrals_market_polish.sql`.
2. В production добавить `TELEGRAM_WEBHOOK_SECRET` (случайная строка) и `NEXT_PUBLIC_BOT_USERNAME=MemeXMarketBot`.
3. Настроить webhook бота на `https://YOUR_DOMAIN/api/telegram/webhook` и передать тот же `secret_token`.
4. Для цифровых товаров invoice создаётся в валюте `XTR`; `provider_token` не используется.
5. Баланс начисляется только после `successful_payment` от Telegram webhook. Callback `openInvoice` сам по себе денег не начисляет.

Пакеты v0.46: 50★ → 750 виртуальных TON, 100★ → 1 600, 250★ → 4 250, 500★ → 9 000, 1000★ → 19 000.

## Реферальная система

Ссылка имеет вид `https://t.me/MemeXMarketBot?startapp=ref_CODE`.

Реферер получает 5% бонусом от **системных начислений** приглашённого:
- награды заданий;
- покупки Stars.

Торговые продажи и переводы не дают реферальный процент. Иначе игроки могли бы бесконечно гонять один и тот же виртуальный TON между аккаунтами и печатать реферальную эмиссию.

Реферер привязывается один раз и только в течение первых 7 дней после регистрации аккаунта.
