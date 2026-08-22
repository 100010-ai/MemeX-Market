# MXM v0.63.1 — Cases 503 Production Hotfix

## Symptom

Production `POST /api/cases` could return HTTP `503` with `DB_SCHEMA_OUTDATED` classification.

## Root causes fixed

1. The v0.63 content migration replaced `case_snapshot_v200` but did not re-create `open_case_v200`. A production database that was upgraded from an incomplete/older migration chain could therefore expose a missing or stale RPC signature to PostgREST.
2. `open_case_v200` used unqualified `gen_random_bytes()` while the function is defined with `SET search_path=public`. Hosted Supabase commonly keeps extension functions outside `public`; PostgreSQL can therefore raise `42883` at runtime even when pgcrypto is installed.

## Fix

- Added `supabase/migrations/100000_cases_runtime_hotfix_v13_1.sql`.
- Re-creates `open_case_v200(uuid,text,uuid)` explicitly.
- Replaces the extension-schema-dependent RNG with 128 random bits from `gen_random_uuid()` decoded to `bytea`.
- Re-applies service-role-only EXECUTE permissions.
- Sends `NOTIFY pgrst, 'reload schema'` so PostgREST refreshes RPC signatures immediately.
- Added structured server-side diagnostics for case snapshot/open failures without exposing database internals to players.
- Package version bumped to `0.63.1` and release gate updated.

## Deployment order

Apply the SQL migration **before** deploying the v0.63.1 code. The SQL alone is sufficient to repair the currently deployed `/api/cases` RPC path if the rest of v0.63 is already deployed.
