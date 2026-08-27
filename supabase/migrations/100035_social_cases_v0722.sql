-- More MXM-only cases. The shop purchases these through mxm_sink_products;
-- Telegram Stars remain limited to currency top-ups.
insert into public.store_products(sku,category,title,description,stars_price,reward_label,badge,sort_order,metadata,active) values
  ('case_nebula','cases','Nebula Cache','Кейс за MXM с шансом на космическую рамку.',5,'1 кейс Nebula Cache','Новый',351,'{"caseTier":"rare","purchaseCurrency":"mxm","asset":"/assets/cases/nebula-cache.png"}'::jsonb,true),
  ('case_prism','cases','Prism Circuit','Коллекционный кейс за MXM с редкой визуальной серией.',5,'1 кейс Prism Circuit','Лимит',352,'{"caseTier":"epic","purchaseCurrency":"mxm","asset":"/assets/cases/prism-circuit.png"}'::jsonb,true),
  ('case_league','cases','League Vault','Сезонный наградной кейс. В магазине не продаётся.',5,'League Vault','League',353,'{"caseTier":"legendary","purchaseCurrency":"none","asset":"/assets/cases/league-vault.png"}'::jsonb,true)
on conflict(sku) do update set category=excluded.category,title=excluded.title,description=excluded.description,stars_price=excluded.stars_price,reward_label=excluded.reward_label,badge=excluded.badge,sort_order=excluded.sort_order,metadata=excluded.metadata,active=true,updated_at=now();

insert into public.case_definitions(sku,title,tier,description,remaining_supply,active,rare_pity,epic_pity,legendary_pity) values
  ('case_nebula','Nebula Cache','rare','Космическая серия с редкими рамками и косметикой.',24000,true,5,12,30),
  ('case_prism','Prism Circuit','rare','Лимитированная серия с яркими коллекционными предметами.',12000,true,4,9,20),
  ('case_league','League Vault','legendary','Наградной кейс MemeX League, доступен только через сезонные награды.',null,true,null,4,10)
on conflict(sku) do update set title=excluded.title,tier=excluded.tier,description=excluded.description,active=true,
  rare_pity=excluded.rare_pity,epic_pity=excluded.epic_pity,legendary_pity=excluded.legendary_pity;

insert into public.mxm_sink_products(sku,mxm_price,sort_order,active) values
  ('case_nebula',7200,351,true),('case_prism',12800,352,true)
on conflict(sku) do update set mxm_price=excluded.mxm_price,sort_order=excluded.sort_order,active=true;

delete from public.case_loot_definitions where case_sku in ('case_nebula','case_prism','case_league');
insert into public.case_loot_definitions(case_sku,reward_key,reward_kind,reward_label,amount,weight,rarity,metadata,active) values
  ('case_nebula','mxm_1000','mxm_coins','1 000 MXM',1000,3600,'common','{}',true),
  ('case_nebula','energy_75','energy','75 энергии',75,2100,'rare','{}',true),
  ('case_nebula','mxm_3200','mxm_coins','3 200 MXM',3200,3000,'rare','{}',true),
  ('case_nebula','challenger_frame','profile_item','Рамка League Challenger',1,1100,'epic','{"itemKey":"league_challenger_frame","duplicateMxm":5200}',true),
  ('case_nebula','mxm_12000','mxm_coins','12 000 MXM',12000,200,'legendary','{}',true),
  ('case_prism','mxm_2600','mxm_coins','2 600 MXM',2600,2600,'rare','{}',true),
  ('case_prism','energy_120','energy','120 энергии',120,1600,'rare','{}',true),
  ('case_prism','mxm_8500','mxm_coins','8 500 MXM',8500,3300,'epic','{}',true),
  ('case_prism','apex_frame','profile_item','Рамка League Apex',1,1800,'legendary','{"itemKey":"league_apex_frame","duplicateMxm":15000}',true),
  ('case_prism','mxm_24000','mxm_coins','24 000 MXM',24000,700,'legendary','{}',true),
  ('case_league','challenger_frame','profile_item','Рамка League Challenger',1,6500,'epic','{"itemKey":"league_challenger_frame","duplicateMxm":5200}',true),
  ('case_league','apex_frame','profile_item','Рамка League Apex',1,2800,'legendary','{"itemKey":"league_apex_frame","duplicateMxm":15000}',true),
  ('case_league','founder_frame','profile_item','Рамка League Founder',1,700,'legendary','{"itemKey":"league_founder_frame","duplicateMxm":30000}',true);

revoke execute on function public.refresh_market_mission_progress_v0722(uuid),public.ensure_league_season_v0722(),
  public.refresh_league_entries_v0722(uuid),public.finalize_league_seasons_v0722(),public.league_snapshot_v0722(uuid),
  public.market_radar_snapshot_v0722(),public.league_hall_of_fame_snapshot_v0722() from public,anon,authenticated;
grant execute on function public.refresh_market_mission_progress_v0722(uuid),public.ensure_league_season_v0722(),
  public.refresh_league_entries_v0722(uuid),public.finalize_league_seasons_v0722(),public.league_snapshot_v0722(uuid),
  public.market_radar_snapshot_v0722(),public.league_hall_of_fame_snapshot_v0722() to service_role;
