# MemeX Market — Build & Runtime Bugfix Audit v7

This pass starts from the MRKT/player-only v6 archive and targets the reported production typecheck failures plus adjacent runtime failure modes.

## Fixed build blockers

- `app/api/collections/[name]/sweep/route.ts`: removed Supabase/PostgREST recursive generic instantiation from the dynamic candidate query. The builder is widened immediately through `lib/supabase/loose-query.ts`, so TypeScript does not recursively parse the long filter chain (`TS2589`).
- `app/api/market/search/route.ts`: the large `gift_market_overview` search builder now uses the same bounded structural query type. Search input is also normalized/sanitized before it is interpolated into PostgREST `.or()` syntax.
- Removed all remaining mutable/reassigned Supabase filter-builder patterns found by the static audit.

## Runtime/data-safety fixes

- Telegram Gift inventory/catalog sync no longer aborts the entire sync because one upstream Gift is malformed or has conflicting identity metadata. Invalid/conflicting rows are rejected, valid rows continue, and `gift_sync_runs.skipped_invalid` records the diagnostic count.
- Exact duplicate Telegram rows are deduplicated but are not falsely counted as malformed.
- Added migration `9996_gift_sync_resilience.sql` for `gift_sync_runs.skipped_invalid`.
- Gift resolver no longer converts Supabase/schema failures into a false “not found”.
- Telegram Gift file/TGS routes no longer disguise DB/schema errors as media 404s. Invalid file IDs return 400; known media that fails upstream returns 502.
- Gift media/Telegram avatar/TGS responses are size-bounded while streaming, before full buffering.
- Gzip/Lottie decompression uses `maxOutputLength`, preventing compressed media from expanding without a hard memory bound.
- Failed/non-image upstream media response bodies are cancelled instead of leaving unread bodies/connections behind.
- Previously ignored awaited Supabase mutations were audited; the current source contains zero ignored awaited Supabase calls in `app/` and `lib/`.

## Static verification performed in the audit environment

- 172 TS/TSX source files parsed: 0 syntax errors.
- 77 API route files: 0 HTTP exports without the common `withApiErrors` guard.
- 0 direct `request.json()` usages in API routes.
- 0 mutable/reassigned Supabase query-builder patterns found by the audit search.
- 53 runtime SQL relations/views referenced; 0 missing from the migration set (Supabase Storage bucket `coin-media` is handled separately).
- 78 runtime RPC names referenced; 0 missing definitions from the migration set.
- All product/security/schema checks in `scripts/release-check.mjs` pass, including the new TS2589 and bounded-media checks.
- Secret scanner reports no probable literal secrets in the artifact.

## Environment limitation

A real Next.js build could not execute in this audit container because the archive intentionally contains no `node_modules`, and Corepack cannot download pinned `pnpm@10.15.0` due DNS/network failure to `registry.npmjs.org` (`EAI_AGAIN`). Consequently the release gate's TypeScript and ESLint subprocesses cannot start here. This is an environment/dependency-availability limitation, not a reported green build.

Run in a networked checkout before production deployment:

```bash
pnpm install --frozen-lockfile
pnpm run release:check
pnpm run build
```

Apply all migrations in filename order, including `9994`, `9995`, and the new `9996`.
