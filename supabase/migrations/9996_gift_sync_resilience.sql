begin;

-- A malformed Telegram Gift must not fail an otherwise valid inventory sync.
-- Keep the skipped count visible to diagnostics instead of hiding bad upstream data.
alter table public.gift_sync_runs
  add column if not exists skipped_invalid integer not null default 0
  check (skipped_invalid >= 0);

commit;
