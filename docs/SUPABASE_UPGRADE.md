# Supabase upgrade — MXM v0.8.1

## Existing v0.8 database

Run only:

```text
supabase/migrations/009_v081_npc_liquidity.sql
```

## Existing v0.7 database

Run in order:

```text
supabase/migrations/008_v08_global_resale_virtual_ton.sql
supabase/migrations/009_v081_npc_liquidity.sql
```

Migration 009 converts any legacy v0.8 `telegram_resale` catalogue rows to the new `bot_catalog` source type. The MTProto runtime is no longer used after this migration.

## Runtime configuration

Required production values:

```env
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
SUPABASE_PUBLISHABLE_KEY=...
TELEGRAM_BOT_TOKEN=...
SESSION_SECRET=...
```

Optional:

```env
ADMIN_TELEGRAM_IDS=123456789
```

Do not add `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` or `TELEGRAM_USER_SESSION`: v0.8.1 does not use them.

## Preparing the Gift market

1. Start the project locally with `npm run dev`.
2. Open `http://localhost:3000/control`.
3. Copy the automatically generated key from the terminal or `.mxm-control-secret`.
4. Open **Подарки**.
5. Add one or more numeric Telegram IDs as catalogue sources.
6. Click **Синхронизировать каталог**.
7. Run **NPC-ликвидность** if you want to prewarm the initial market immediately.

Only real Unique Gift payloads returned by Telegram Bot API are persisted. If Telegram returns nothing, MXM does not create replacement/mock Gifts.
