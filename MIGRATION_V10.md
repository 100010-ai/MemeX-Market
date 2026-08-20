# Migration v9 -> v10

## 1. Backup

Export the production Supabase database before applying schema changes.

## 2. Apply SQL

If the database already has v8 + v9, execute only:

```text
supabase/schema_v10.sql
```

The migration is wrapped in one transaction. If any statement fails, the transaction should roll back instead of leaving half of v10 installed.

## 3. Set Vercel environment variables

Use `.env.example` as the source of required variable names. Never upload `.env.local` to GitHub.

Generate a strong session secret, for example locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 4. Deploy

```bash
npm install
npm run check:env
npm run typecheck
npm run lint
npm run build
vercel --prod
```

## 5. Telegram URL

Point the Telegram Mini App to the production HTTPS domain.

## 6. Test checklist

- Launch from Telegram authenticates successfully.
- `/api/session` returns the current verified player.
- Refresh keeps the same `tg_<telegram id>` identity.
- A second device for the same Telegram user maps to the same profile.
- Friend/clan operations still satisfy RLS.
- Case roll and claim work through `/api/cases/*`.
- Race result appears once even if the submit request is retried.
- Direct browser update of `wins`, `balance` or `rating` does not change those DB values.
- `SUPABASE_SERVICE_ROLE_KEY` and `TELEGRAM_BOT_TOKEN` cannot be found in browser Sources/network payloads.

## Rollback

Because v10 mostly adds tables/functions and hardens profile writes, rollback should be performed from the database backup or a tested dedicated rollback migration. Do not blindly drop v10 tables on production if race/principal data has already been written.
