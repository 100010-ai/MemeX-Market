# MemeX Market v8 — build + Telegram channel mission audit

## Build blocker fixed

- `app/api/telegram/avatar/route.ts`: binary `Uint8Array<ArrayBufferLike>` is no longer passed directly to `NextResponse`; all binary bodies go through `toBodyArrayBuffer()` and have an exact `ArrayBuffer` body type.
- `app/api/telegram/file/[fileId]/route.ts`: same exact-`ArrayBuffer` path plus bounded upstream buffering.
- Release gate confirms both binary routes use the shared body helper.

## Telegram main-channel mission

- Added onboarding mission `join_main_channel` for `https://t.me/Meme_X_Market`.
- Verification uses Telegram Bot API `getChatMember`; client-side claims are never trusted.
- Claim RPC requires a successful membership verification from the previous 2 minutes.
- Added task UI actions: open channel, verify membership, then claim.
- Added `chat_member` webhook handling for immediate join/leave detection.
- Added `app/api/system/channel-subscription-audit` for periodic CRON verification.
- `/api/me` re-audits previously rewarded users when membership verification is stale.
- If a rewarded user leaves, the conditional virtual-TON reward is revoked.
- If the reward was already spent, the unrecovered part becomes clawback debt and is automatically retained from future positive balance credits.
- The conditional channel reward does not produce a referral bonus, preventing an unsubscribe/referral farming path.
- Added `pnpm telegram:webhook` to configure `message`, `pre_checkout_query`, and `chat_member` webhook updates.

## Required production setup

1. Apply `supabase/migrations/9997_main_channel_subscription_task.sql`.
2. Add the bot from `TELEGRAM_BOT_TOKEN` as an administrator of `@Meme_X_Market` (Telegram only guarantees `getChatMember` checks for other users when the bot is admin).
3. Ensure `.env` contains `TELEGRAM_MAIN_CHANNEL_USERNAME=Meme_X_Market`.
4. After deployment, run `pnpm telegram:webhook` with production env loaded.

## Static verification

- 79 API route files.
- 0 HTTP handlers without `withApiErrors`.
- 0 direct `request.json()` usages in API routes.
- 79 runtime RPC names referenced; all have migration definitions.
- 54 `.from(...)` names found; the only non-table name is the Supabase Storage bucket `coin-media`.
- `release:check` passes all project-specific checks including binary media, TS2589 guards, player-only market and server-verified channel subscription. Its TypeScript/ESLint subprocesses cannot run in this container because `node_modules` is unavailable and npm registry DNS is blocked.
