begin;

create index if not exists coin_milestones_v078_trade_idx
  on public.coin_milestones_v078(trade_id)
  where trade_id is not null;

commit;
