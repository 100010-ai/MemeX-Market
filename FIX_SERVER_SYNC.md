# Fix: profile says server is not synchronized

The old v12 UI collapsed several unrelated failures into one message: “Telegram session unavailable”. v12.2 separates them.

## Correct recovery sequence

1. In Supabase SQL Editor run:

```text
supabase/schema_v12_2_FULL.sql
```

2. In Vercel → Project → Settings → Environment Variables verify all required variables from `.env.example`.

3. Confirm these pairs belong together:

```text
NEXT_PUBLIC_SUPABASE_URL       -> same Supabase project
SUPABASE_SERVICE_ROLE_KEY      -> same Supabase project
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -> same Supabase project

TELEGRAM_BOT_TOKEN             -> exact bot opening the Mini App
TELEGRAM_BOT_USERNAME          -> same bot username, without @
```

4. Redeploy the Vercel project.

5. Close the Telegram Mini App completely and reopen it from the bot button.

## Why the screenshot happened

The game shell and local save can load without server auth. That is why the profile could show a local name, car and SYND balance while friends/clans/chat were unavailable. The previous auth route also returned some database failures as HTTP 401, causing the client to incorrectly blame Telegram authorization.

v12.2 fixes that classification and no longer shows the generic “Не удалось восстановить Telegram-сессию” toast for database/configuration failures.
