# MemeX Market — Build & Reliability Fix v12

## Fixed build blocker

- `app/api/notifications/route.ts`: removed the unsafe spread of `preferences.data` that caused `TS2698: Spread types may only be created from object types`.
- Notification preferences are now normalized through a typed allow-list. Unknown/non-boolean values cannot leak into the API response.

## Notification system hardening

- Added shared `lib/notifications.ts` contract for preference keys/defaults.
- Notification links are restricted to internal Mini App paths; protocol-relative/external values are discarded.
- Preference writes reject empty updates.
- Client preference toggles send only the changed key instead of the whole stale preferences object.
- Optimistic preference updates use a targeted rollback, preventing rapid toggles from overwriting one another.
- Successful notification actions clear stale UI error state.

## Gift offer protection

- Added an authenticated actor/IP rate limit to accept/cancel offer actions (`30/min` per player) before the transactional RPC is called.

## Admin/control validation

- Invalid moderation dates no longer throw `RangeError` through `toISOString()`; malformed dates return HTTP 400.
- Mission create/update now bounds reward and target values consistently, preventing negative or extreme economy values through admin/control endpoints.
- Promo creation validates start/end timestamps and rejects an end date that is not after the start date.
- Promo updates now enforce the same reward/use limits as promo creation.

## Verification in this environment

- 178 TS/TSX source files parsed with TypeScript compiler API: 0 syntax-error files.
- Local `@/` import resolver scan: 0 missing source modules.
- Built-in release gate: 93 product/security/domain checks pass.
- Full `pnpm run build` / ESLint cannot be executed in this sandbox because the uploaded archive has no `node_modules` and outbound npm registry access is unavailable.

No new database migration is required for this v12 code-only fix.
