# Migration v10 → v11

## Database

Run once in Supabase SQL Editor:

```text
supabase/schema_v11.sql
```

The migration is wrapped in one transaction.

It adds:

- player ban fields;
- admin audit log;
- dynamic car catalog;
- dynamic opponent catalog;
- game settings;
- configurable bot commands;
- Telegram webhook update idempotency;
- private duel rooms;
- service-role-only admin player RPC.

All new internal tables have RLS enabled and direct grants revoked from `anon` and `authenticated` where the browser does not need direct access.

## Environment

Add:

```dotenv
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
ADMIN_TELEGRAM_IDS=
```

alongside the existing v10 server secrets.

## Deploy

1. Apply SQL.
2. Configure Vercel environment variables.
3. Deploy v11.
4. Configure BotFather Privacy Mode for group duel words; see `BOT_SETUP.md`.
5. Open `/admin` through Telegram.
6. Register the webhook from Control Center.
7. Test `/start` in private chat.
8. Test `дуэль` as a reply between two different accounts in a group.
9. Confirm a third account cannot open the duel room.
