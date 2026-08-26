begin;

-- Keep the displayed Glacier Protocol odds on an exact 10 000-weight basis.
update public.case_loot_definitions
set weight=3200
where case_sku='case_glacier' and reward_key='mxm_650';

commit;
