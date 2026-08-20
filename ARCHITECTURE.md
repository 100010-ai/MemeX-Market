# Architecture — v12

## Identity and request boundary

```text
Telegram Mini App / Bot
        │
        ├─ Mini App initData ───────────────┐
        │                                   ▼
        │                         POST /api/auth/telegram
        │                           HMAC + auth_date check
        │                                   │
        │                                   ├─ stable player tg_<telegram_id>
        │                                   ├─ stable Supabase principal
        │                                   └─ signed HttpOnly session
        │
        └─ Bot update ──────────────────────┐
                                            ▼
                              POST /api/telegram/webhook
                              secret-token verification
                              update_id idempotency
                                            │
          ┌─────────────────────────────────┴──────────────────────────────┐
          ▼                                                                ▼
 Next.js API routes                                                Bot / duel handler
 session + Origin + Zod                                            commands / callbacks
 DB rate limits                                                    chat duel creation
          │                                                                │
          └─────────────────────────┬───────────────────────────────────────┘
                                    ▼
                         server-only feature modules
                                    │
                                    ▼
                       Supabase service role / RPC / RLS
```

## Server modules

- `features/admin`: allowlist authorization, statistics, moderation and content management.
- `features/bot`: Telegram update parsing, DB-backed custom commands and Bot API calls.
- `features/duels`: private duel-room lifecycle and participant authorization.
- `features/race`: gear/physics boundaries and race-result submission.
- `features/cases`: server roll/claim boundary.
- `features/market`: server-controlled market mutations.
- `features/profile`: restricted presentation-profile synchronization.
- `features/social`: friends.
- `features/clans`: clan actions.
- `lib/security`: signed session, same-origin checks, durable rate limiting.
- `lib/telegram`: Mini App `initData` validation.
- `lib/supabase`: strictly separated browser/server clients.

## Dynamic content

v12 moves the content required by the duel network behind a server bootstrap:

```text
game_cars_v12
    └─ /api/game/bootstrap ──> active car catalog

game_opponents_v12
    └─ /api/game/bootstrap ──> active opponent catalog

game_settings_v12
    └─ /api/game/bootstrap / server systems
```

This allows cars/opponents/balance flags to be edited from Control Center without embedding administrator credentials in the client.

## Admin plane

`/admin` is a separate React control surface. Every API call independently re-checks the signed Telegram session and `ADMIN_TELEGRAM_IDS`; hiding the page is not the authorization mechanism.

Privileged player actions pass through `autosyndicate_admin_player_action_v12`. Administrative changes also write `admin_audit_log_v12`.

## Telegram command plane

```text
Telegram update
  → webhook secret header
  → update_id insert
  → command/callback/duel dispatcher
```

Custom commands live in `bot_commands_v12`. `/admin` remains application code so a DB content editor cannot accidentally turn a public command into administrative access.

## Private duel lifecycle

`duel_rooms_v12` is server-only. The public code is an opaque locator, not authorization.

States:

```text
pending → accepted → ready → racing → finished
           └───────────────→ cancelled/declined/expired
```

Participant checks use the verified server session (`tg_<telegram id>`). Car selection verifies ownership against the player's current inventory. Each participant can submit at most one result. When both results exist the server fixes the winner and reports it back to the originating Telegram chat.

The v12 duel is a synchronized **instanced** race foundation: both clients share room state and `start_at`, while each device renders its race locally. It is not yet a frame-by-frame networked two-lane simulation. A future live-PvP layer should add server-validated telemetry/commit proofs rather than trusting high-frequency client coordinates.

## Legacy compatibility layer

`src/legacy/runtime.ts` still contains mature rendering/UI mechanics from the pre-TypeScript build and is isolated with `@ts-nocheck`. v12 wraps it with typed server boundaries instead of attempting a dangerous one-shot rewrite.

New authoritative economy, admin, bot and room logic must stay outside that file. The remaining migration path is to move screen controllers and local economy state into typed feature modules incrementally.


## v12 synchronization path

Protected gameplay does not read identity from request JSON. The client sends only the requested action; the server resolves `playerId` from the signed Telegram session.

```text
Telegram initData → /api/auth/telegram → telegram_principals/player_profiles
                                   ↓
                           HttpOnly session
                                   ↓
                             /api/* routes
                                   ↓
                    server-only Supabase client
```

The optional browser Supabase client is isolated to non-authoritative realtime acceleration. HTTP APIs remain functional without it.

The legacy runtime uses a common `serverFetch()` wrapper with credentials, a 12-second timeout, network-state tracking and one-shot re-auth/retry on HTTP 401. This prevents individual screens from implementing incompatible authentication recovery logic.
