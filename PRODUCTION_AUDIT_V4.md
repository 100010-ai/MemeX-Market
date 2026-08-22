# MemeX Market production audit v4

This tree contains the production hardening pass over the supplied Next.js 16 + Supabase + Telegram Mini App project.

## Required deployment order

1. Use Node.js >= 20.9 and pnpm 10.15.x.
2. Run `pnpm install --frozen-lockfile`.
3. Apply every SQL file in `supabase/migrations/` in filename order. Do not stop at migration 029. The current runtime requires the 030 and 999x repair migrations, including `9993_production_runtime_reliability.sql` and the final `999_fix_telegram_auth.sql`.
4. Copy `.env.production.example` to the deployment environment and replace placeholders. Never commit the real file.
5. Run `pnpm run release:check` and `pnpm run build`.
6. Smoke-test `/api/me`, `/api/market`, `/api/orders`, `/api/portfolio`, `/api/leaderboard`, and a real `/api/gifts/[id]` inside Telegram Desktop and Telegram Mobile.

## Key fixes in this pass

- Removed retired AdsGram/rewarded-ad runtime code and added prebuild cleanup for dirty checkouts.
- Repaired `profile_financial_overview`, `leaderboard`, portfolio snapshots, and Telegram profile-sync migration ordering.
- Added consistent JSON API error guards and safe JSON/form parsing.
- Missing DB relations/columns/RPCs are reported as `503 DB_SCHEMA_OUTDATED` instead of opaque 500 responses.
- Unified Gift media resolution and rejects `tonapi:*:symbol` as a direct image URL.
- Hardened Telegram auth/session handling and profile data mapping.
- Made price alerts atomic, notification delivery claim-based with `SKIP LOCKED`, and Telegram webhook processing idempotent by `update_id`.
- Added a Telegram avatar proxy/fallback and application icon to eliminate common WebView 404 noise.
- Made UI number/date/color formatters non-throwing for malformed remote data.
- Project is pnpm-only; conflicting npm lock and generated build artifacts are removed.

## Verification performed in the audit environment

- 170 TypeScript/TSX files parsed with 0 syntax errors.
- 75 API route files found; 0 HTTP handlers missing the common error guard.
- 0 direct `request.json()` calls remain under `app/api`.
- 0 retired advertising imports/references remain in runtime code.
- 52 runtime Supabase relations/views referenced; 0 missing from the migration set.
- 74 runtime RPC names referenced; 0 missing from the migration set.
- Release-gate product/schema/security checks pass through the dependency-backed TypeScript/ESLint stages.

The supplied audit environment does not contain `node_modules` or pnpm and cannot reach the package registry, so a real Next.js `pnpm run build` cannot be truthfully certified here. The final deployment/CI environment must execute the dependency-backed release check and build.
