# Supabase upgrade

## Existing v0.8.1 database

Run only:

```text
supabase/migrations/010_v09_mrkt_flow.sql
```

## What v0.9 adds

- Persistent server-side marketplace cart.
- Atomic batch Gift checkout.
- Collection-diverse NPC candidate ordering.

No mock or demo Gift rows are inserted by this migration.
