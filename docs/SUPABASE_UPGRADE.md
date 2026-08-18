# Supabase upgrade to MXM v0.5

## Existing v0.4.1 database

Run:

```text
supabase/migrations/003_v05_real_market_core.sql
```

## Old v0.2 database

Run:

```text
supabase/migrations/002_remove_legacy_placeholders.sql
supabase/migrations/003_v05_real_market_core.sql
```

The corrected `002` tears down dependent legacy views before dropping `demo_emoji` / `reference_price`, then recreates the current v0.4.1 schema.

## Fresh database

Run:

```text
supabase/migrations/001_init.sql
supabase/migrations/002_remove_legacy_placeholders.sql
supabase/migrations/003_v05_real_market_core.sql
```

`003` adds Gift sync diagnostics, Telegram symbol-media flags, burned-state handling, cash reservation for open Gift offers, minute Gift candles, offer depth, separate PnL leaderboard metrics and additional missions.

No migration in the v0.5 path inserts demo market assets.
