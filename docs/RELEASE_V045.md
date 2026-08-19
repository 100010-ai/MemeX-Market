# MXM v0.45.0

Основной релиз экономики, rewarded-рекламы, UX запуска мемкоинов и security-аудита.

- Убрана публичная market-side сводка коллекций/floor.
- Gift filters переведены на единый portal drawer.
- Исправлен экран создания мемкоина и удалена фиктивная «25 000 000 TON» позиция.
- Новая управляемая экономика: launch fee 150, rewarded ad +50 (2/day), 12h launch cooldown, 2 active coins, 0.5% AMM sink, 2.5% Gift treasury fee.
- Добавлен AdsGram Rewarded с production server confirmation.
- Добавлен economy ledger и учёт AMM fee sinks в админке.
- PnL теперь означает realized trading PnL.
- Усилены Telegram file/TGS limits и timeouts.
- Проведён статический аудит: `docs/AUDIT_V045.md`.
- Настройка рекламы: `docs/ADS_REWARDED_SETUP_V045.md`.
