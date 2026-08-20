# MXM v0.45.0

Исторический релиз управляемой экономики, UX запуска мемкоинов и security-аудита.

- Убрана публичная market-side сводка коллекций/floor.
- Gift filters переведены на единый portal drawer.
- Исправлен экран создания мемкоина и удалена фиктивная «25 000 000 TON» позиция.
- Добавлены launch fee 150, 12h launch cooldown, 2 active coins, 0.5% AMM sink и 2.5% Gift treasury fee.
- Добавлен economy ledger и учёт AMM fee sinks в админке.
- PnL теперь означает realized trading PnL.
- Усилены Telegram file/TGS limits и timeouts.
- Проведён статический аудит: `docs/AUDIT_V045.md`.

Рекламный эксперимент этой исторической версии полностью выведен из эксплуатации обновлением Market 2.0; live-код, API, настройки и таблицы удаляет миграция 028.
