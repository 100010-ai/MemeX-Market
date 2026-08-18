# Supabase upgrade — MXM v0.8

## v0.7 → v0.8

Выполнить только:

```text
008_v08_global_resale_virtual_ton.sql
```

Миграция:

- добавляет source/TON/media metadata для `gift_assets`;
- создаёт `catalog_sync_state` и `catalog_sync_runs`;
- добавляет DB lock RPC для global catalog sync;
- создаёт hidden system treasury profile для первичного виртуального inventory;
- добавляет `seed_global_catalog_gift`;
- создаёт/настраивает public `gift-media` Storage bucket;
- расширяет `gift_market_overview` global-resale полями;
- обновляет пользовательскую ошибку создания мемкоина под virtual TON.

Миграция не вставляет demo market assets.

## Fresh database

Запустить по порядку:

```text
001_init.sql
002_remove_legacy_placeholders.sql
003_v05_real_market_core.sql
004_v06_exchange_retention.sql
005_v061_ru_ui.sql
006_market_drops.sql
007_v07_control_performance.sql
008_v08_global_resale_virtual_ton.sql
```

## После миграции

Настроить server environment:

```text
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_USER_SESSION
```

Проверить `/api/health`: `globalResaleCatalogConfigured` должен быть `true`.

Перед публичным запуском рекомендуется один раз открыть локальный `/control` и выполнить `Обновить Telegram Resale`, чтобы первый пользователь не ждал initial sync. Даже без prewarm пустой Gift Market имеет automatic bootstrap при первом market request.
