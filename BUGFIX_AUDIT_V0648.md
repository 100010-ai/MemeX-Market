# MemeX Market v0.64.8 — Orders schema compatibility hotfix

## Production symptom
`/orders` displayed `База данных MXM требует актуальной production-миграции` and returned `DB_SCHEMA_OUTDATED`.

## Root cause
The optimized Orders API introduced in the existing-systems polish queried `gift_offers.seller_profile_id`. That denormalized column lives in `9999_existing_systems_polish.sql`, but recent release instructions did not require that older-named migration, so a production database could legitimately be on the newer memecoin/progression migrations while still missing this one column.

## Fix
- `/api/orders` no longer requires `seller_profile_id` to exist just to render the page.
- The normal fast path still uses the indexed seller column when available.
- If the column is absent, incoming offers are resolved through the existing `gift_offers -> virtual_gifts` FK join.
- The client disables the unsupported seller-column Realtime filter in compatibility mode and uses a lightweight 12-second visible-page reconciliation instead.
- Added idempotent `100003_orders_runtime_compat_v0648.sql` to restore the optimized seller-scoped path in production.
- Migration reloads PostgREST schema cache after commit.

This keeps the page usable before the SQL is applied while still restoring the intended production-performance path after migration.
