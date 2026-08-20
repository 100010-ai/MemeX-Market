# Security model — v12

## Implemented boundaries


## v12 synchronization boundary

The signed Telegram/Vercel session is now the primary browser-to-server identity boundary. Social and synchronization features no longer depend on the optional browser Supabase Auth session.

`requireSession()` validates three pieces together on every protected server operation:

- signed unexpired session cookie;
- matching `player_profiles` row;
- matching `telegram_principals` row for the verified Telegram numeric ID.

A stale/missing principal is treated as `401`, which lets the Mini App re-run Telegram `initData` verification and repair the principal before retrying once.

Friends, clans, chat, market mutations, case reconciliation, referrals, bank operations and legacy async PvP are routed through Next.js API handlers. v12 revokes obsolete direct browser mutations for the chat/bank/PvP/case/referral/social paths covered by the migration.

The browser Supabase client is **not** an authorization requirement anymore. If a one-time Supabase browser token cannot be created, server-backed gameplay continues and realtime-capable screens fall back to API polling/manual refresh.


### Telegram Mini App identity

`initData` is validated on the server with the bot token and an `auth_date` freshness window. The application derives the player identity from the verified Telegram user ID rather than accepting a browser-supplied `playerId`.

### Stable Supabase principal

Each verified Telegram account maps to a stable Supabase user. The browser receives a short-lived one-time token hash for its Supabase session; `SUPABASE_SERVICE_ROLE_KEY` never reaches client JavaScript.

### Server-only secrets

Never expose or prefix these with `NEXT_PUBLIC_`:

- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME` (kept server-side in this build)
- `TELEGRAM_WEBHOOK_SECRET`
- `SESSION_SECRET`
- `ADMIN_TELEGRAM_IDS`

### Signed HttpOnly session

Next.js server endpoints authenticate with an HMAC-signed, expiring `HttpOnly` cookie. Production cookies are `Secure` and `SameSite=Lax`.

### Origin checks

State-changing browser API calls verify the request Origin against the deployment host. This provides an additional CSRF boundary around cookie-authenticated mutations.

### Durable rate limiting

Rate limits use an atomic Supabase/Postgres counter rather than Vercel process memory. This matters because serverless instances are disposable and horizontally scaled.

### Ban enforcement

A ban is a database state (`banned_at`, `ban_reason`), not a hidden frontend button. Authentication and server sessions reject banned profiles; privileged actions remain audit logged.

### Admin authorization

Control Center requires both:

- a valid Telegram-derived game session;
- the numeric Telegram ID in `ADMIN_TELEGRAM_IDS`.

Every admin endpoint repeats the authorization check. `autosyndicate_admin_player_action_v11` is restricted to service-role execution and clamps sensitive numeric payloads.

### Admin audit trail

Privileged content/player/settings operations are recorded in `admin_audit_log_v11`. This makes balance changes, bans and content edits attributable to an administrator.

### Telegram webhook authenticity

The bot webhook validates `X-Telegram-Bot-Api-Secret-Token` with a timing-safe comparison. Telegram `update_id` is persisted before dispatch so duplicate deliveries are ignored.

### Bot command isolation

Custom commands can control response content/buttons only. They cannot directly invoke arbitrary SQL or server code. `/admin` is intentionally hardcoded behind the admin allowlist.

### Private duel authorization

A duel URL/code is only a locator. `/api/duels/room` checks that the verified session belongs to `player_a_id` or `player_b_id`. A copied link used by a third Telegram account returns `403`.

Only the challenged Telegram account can press the accept/decline callback successfully. Car selection checks ownership, and a side can write its race result only once.

### Dynamic game content

`game_cars_v11`, `game_opponents_v11`, `game_settings_v11`, `bot_commands_v11`, `telegram_updates_v11`, `duel_rooms_v11` and the audit log are server-managed. New internal tables have RLS enabled and browser grants revoked where direct browser access is unnecessary.

## Security debt still present

### Legacy wallet / inventory authority

Parts of the older browser runtime still retain wallet/inventory state in `localStorage`. This means v12 should **not** be treated as a finished tamper-proof competitive economy yet.

Before attaching significant real value to SYND/items, finish:

1. server-authoritative wallet ledger;
2. server-owned vehicle instances;
3. server-owned tuning inventory/install transactions;
4. casino debit + payout transactions on the server;
5. server-side race reward calculation;
6. atomic market settlement against server wallet/inventory;
7. removal of obsolete legacy direct-mutation code.

### Duel result validation

v12 provides identity, room access, synchronized start state, range validation and one-shot result submission. The race itself is still simulated locally. A modified client could attempt to submit a plausible-but-fake time.

For ranked/staked PvP, add a stronger proof model such as:

- server-issued race nonce;
- selected-car build snapshot locked before ready;
- event stream/telemetry digest for gear changes and checkpoints;
- deterministic server replay or physical feasibility validation;
- server-calculated reward only after verification.

Do not add wagered/staked duels before this layer exists.

### CSP legacy compatibility

The compatibility runtime still uses inline handlers/styles, so CSP currently allows `'unsafe-inline'`. Once those screens move to React event handlers, replace that allowance with nonce/hash-based CSP.

## Operational checklist

- Never commit `.env.local`.
- Store Production/Preview secrets separately in Vercel.
- Rotate any bot/service/session secret that ever appeared in a public repo or browser bundle.
- Do not log Telegram `initData`, bot tokens, service-role keys, session cookies or magic-link token hashes.
- Keep Supabase RLS enabled.
- Keep `ADMIN_TELEGRAM_IDS` small and numeric.
- Review `admin_audit_log_v11` after privileged changes.
- Disable stale admin accounts immediately.

## v12.3 production hardening

- Server environment values are normalized before validation to prevent accidental whitespace from breaking Telegram HMAC verification.
- Telegram Mini App sessions use `HttpOnly`, `Secure` and production `SameSite=None` cookies so the session survives supported Telegram WebView embedding while write routes keep same-origin validation.
- Session cookies use high priority.
- HSTS, DNS-prefetch disablement, nosniff, CORP, Permissions Policy and CSP remain enabled at the Next.js boundary.
- Player-facing pages no longer expose migration filenames, environment-variable names, cookie state or internal server error details. Operational diagnostics stay in server logs and the protected admin surface.

The legacy wallet/inventory compatibility state is still not a substitute for a fully server-authoritative economy. Valuable competitive rewards should continue to be validated server-side before they become economically significant.
