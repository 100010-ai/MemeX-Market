-- MemeX Market v2.2 content expansion.
-- Adds material-first profile frames, case-exclusive collectibles and seven case series.
-- Store products are inserted before case_definitions because case_definitions.sku
-- is foreign-keyed to store_products.sku.

insert into public.profile_items(item_key,item_type,title,rarity,metadata,active)
values
  ('titanium_edge_frame','frame','Titanium Edge','rare', '{"source":"store_case","motion":"metal","exclusive":false}'::jsonb,true),
  ('graphite_crown_frame','frame','Graphite Crown','epic', '{"source":"store_case","motion":"breathe","exclusive":false}'::jsonb,true),
  ('blue_hour_frame','frame','Blue Hour','epic', '{"source":"store_case","motion":"breathe","exclusive":false}'::jsonb,true),
  ('black_ice_frame','frame','Black Ice','epic', '{"source":"case","motion":"frost","exclusive":true}'::jsonb,true),
  ('crimson_regent_frame','frame','Crimson Regent','epic', '{"source":"case","motion":"breathe","exclusive":true}'::jsonb,true),
  ('silver_archive_frame','frame','Silver Archive','epic', '{"source":"store_case","motion":"metal","exclusive":false}'::jsonb,true),
  ('market_maker_frame','frame','Market Maker','legendary', '{"source":"case","motion":"pulse","exclusive":true}'::jsonb,true),
  ('monolith_frame','frame','Monolith','legendary', '{"source":"case","motion":"breathe","exclusive":true}'::jsonb,true),
  ('singularity_frame','frame','Singularity','legendary', '{"source":"case","motion":"orbit","exclusive":true}'::jsonb,true),
  ('dynasty_frame','frame','Dynasty','legendary', '{"source":"case","motion":"pulse","exclusive":true}'::jsonb,true),
  ('cinder_vault_frame','frame','Cinder Vault','legendary', '{"source":"case","motion":"ember","exclusive":true}'::jsonb,true),
  ('meridian_frame','frame','Meridian','legendary', '{"source":"case","motion":"orbit","exclusive":true}'::jsonb,true),
  ('titanium_operator_badge','badge','Titanium Operator','rare', '{"source":"case","exclusive":true}'::jsonb,true),
  ('afterhours_badge','badge','After Hours','epic', '{"source":"case","exclusive":true}'::jsonb,true),
  ('black_ice_badge','badge','Black Ice Protocol','epic', '{"source":"case","exclusive":true}'::jsonb,true),
  ('exchange_operator_badge','badge','Exchange Operator','epic', '{"source":"case","exclusive":true}'::jsonb,true),
  ('monolith_badge','badge','Monolith Keeper','epic', '{"source":"case","exclusive":true}'::jsonb,true),
  ('dynasty_badge','badge','Dynasty Archive','legendary', '{"source":"case","exclusive":true}'::jsonb,true),
  ('singularity_badge','badge','Singularity Witness','legendary', '{"source":"case","exclusive":true}'::jsonb,true)
on conflict(item_key) do update set
  item_type=excluded.item_type,
  title=excluded.title,
  rarity=excluded.rarity,
  metadata=excluded.metadata,
  active=excluded.active;

insert into public.store_products(sku,category,title,description,stars_price,reward_label,badge,sort_order,metadata,active)
values
  ('profile_titanium_edge','profile','Titanium Edge','Холодная титановая рамка с асимметричным цельным контуром.',79,'Рамка Titanium Edge','Редкая',590,'{"profileItem":"titanium_edge_frame","itemType":"frame","highlights":["Постоянный предмет","Редкость: редкая"]}'::jsonb,true),
  ('profile_graphite_crown','profile','Graphite Crown','Тёмный графитовый гребень с мягким металлическим дыханием.',109,'Рамка Graphite Crown','Эпическая',600,'{"profileItem":"graphite_crown_frame","itemType":"frame","highlights":["Матовый металл","Редкость: эпическая"]}'::jsonb,true),
  ('profile_blue_hour','profile','Blue Hour','Спокойная ночная рамка со стальным синим отливом без неона.',119,'Рамка Blue Hour','Эпическая',610,'{"profileItem":"blue_hour_frame","itemType":"frame","highlights":["Мягкая анимация","Редкость: эпическая"]}'::jsonb,true),
  ('profile_silver_archive','profile','Silver Archive','Серебряная архивная рамка с чистой геометрией и глубоким металлом.',129,'Рамка Silver Archive','Эпическая',620,'{"profileItem":"silver_archive_frame","itemType":"frame","highlights":["Серебряный материал","Редкость: эпическая"]}'::jsonb,true),
  ('case_titanium','cases','Titanium Drop','Индустриальная серия с Titanium Edge и Graphite Crown.',69,'1 кейс Titanium Drop','Новый',340,'{"caseTier":"rare","quantity":1,"highlights":["7 наград","Легендарное 1%","Тираж 32 000"]}'::jsonb,true),
  ('case_afterhours','cases','After Hours','Ночная серия с Blue Hour, Crimson Regent и Singularity.',99,'1 кейс After Hours','Новый',350,'{"caseTier":"rare","quantity":1,"highlights":["7 наград","Эпическое+ 32%","Тираж 18 000"]}'::jsonb,true),
  ('case_black_ice','cases','Black Ice Protocol','Тёмная ледяная серия с эксклюзивной рамкой Black Ice.',129,'1 кейс Black Ice Protocol','Лимит',360,'{"caseTier":"rare","quantity":1,"highlights":["7 наград","Легендарное 11%","Тираж 14 000"]}'::jsonb,true),
  ('case_exchange','cases','Exchange Floor','Трейдерская серия с Silver Archive и Market Maker.',149,'1 кейс Exchange Floor','Trader',370,'{"caseTier":"rare","quantity":1,"highlights":["7 наград","Легендарное 15%","Тираж 12 000"]}'::jsonb,true),
  ('case_monolith','cases','Monolith Reserve','Легендарный резерв с Monolith, Cinder Vault и Meridian.',219,'1 кейс Monolith Reserve','6 000 шт.',380,'{"caseTier":"legendary","quantity":1,"highlights":["7 наград","Легендарное 37%","Тираж 6 000"]}'::jsonb,true),
  ('case_dynasty','cases','Dynasty Vault','Премиальная серия с Dynasty и крупными MXM-наградами.',299,'1 кейс Dynasty Vault','3 000 шт.',390,'{"caseTier":"legendary","quantity":1,"highlights":["7 наград","Легендарное 40%","Тираж 3 000"]}'::jsonb,true),
  ('case_singularity','cases','Singularity 1500','Коллекционный выпуск v2.2 с самым редким пулом серии.',399,'1 кейс Singularity 1500','1 500 шт.',400,'{"caseTier":"legendary","quantity":1,"highlights":["7 наград","Легендарное 44%","Тираж 1 500"]}'::jsonb,true)
on conflict(sku) do update set
  category=excluded.category,
  title=excluded.title,
  description=excluded.description,
  stars_price=excluded.stars_price,
  reward_label=excluded.reward_label,
  badge=excluded.badge,
  sort_order=excluded.sort_order,
  metadata=excluded.metadata,
  active=excluded.active,
  updated_at=now();

insert into public.case_definitions(sku,title,tier,description,remaining_supply,active,rare_pity,epic_pity,legendary_pity)
values
  ('case_titanium','Titanium Drop','rare','Холодная индустриальная серия с Titanium Edge и редким шансом на Market Maker.',32000,true,7,18,55),
  ('case_afterhours','After Hours','rare','Ночная торговая серия с Blue Hour, Crimson Regent и редким Singularity drop.',18000,true,5,10,26),
  ('case_black_ice','Black Ice Protocol','rare','Ледяная тёмная серия с Black Ice, крупным MXM и шансом на Monolith.',14000,true,4,9,22),
  ('case_exchange','Exchange Floor','rare','Серия для активных трейдеров с Silver Archive и эксклюзивной рамкой Market Maker.',12000,true,4,8,18),
  ('case_monolith','Monolith Reserve','legendary','Тяжёлая лимитированная серия с Monolith, Cinder Vault и Meridian.',6000,true,null,5,10),
  ('case_dynasty','Dynasty Vault','legendary','Премиальная серия с Dynasty, Market Maker и крупными MXM-наградами.',3000,true,null,4,8),
  ('case_singularity','Singularity 1500','legendary','Финальная коллекционная серия тиражом 1 500 с самым редким пулом v2.2.',1500,true,null,3,7)
on conflict(sku) do update set
  title=excluded.title,
  tier=excluded.tier,
  description=excluded.description,
  remaining_supply=public.case_definitions.remaining_supply,
  active=excluded.active,
  rare_pity=excluded.rare_pity,
  epic_pity=excluded.epic_pity,
  legendary_pity=excluded.legendary_pity;

insert into public.case_loot_definitions(case_sku,reward_key,reward_kind,reward_label,amount,weight,rarity,metadata,active)
values
  ('case_titanium','mxm_350','mxm_coins','350 MXM',350,3200,'common','{}',true),
  ('case_titanium','energy_45','energy','45 энергии',45,2200,'common','{}',true),
  ('case_titanium','mxm_1100','mxm_coins','1 100 MXM',1100,1900,'rare','{}',true),
  ('case_titanium','operator_badge','profile_item','Значок Titanium Operator',1,1100,'rare','{"itemKey":"titanium_operator_badge","duplicateMxm":900}',true),
  ('case_titanium','titanium_frame','profile_item','Рамка Titanium Edge',1,900,'epic','{"itemKey":"titanium_edge_frame","duplicateMxm":2600}',true),
  ('case_titanium','graphite_frame','profile_item','Рамка Graphite Crown',1,600,'epic','{"itemKey":"graphite_crown_frame","duplicateMxm":4300}',true),
  ('case_titanium','market_maker_frame','profile_item','Рамка Market Maker',1,100,'legendary','{"itemKey":"market_maker_frame","duplicateMxm":12000}',true),
  ('case_afterhours','mxm_900','mxm_coins','900 MXM',900,2800,'common','{}',true),
  ('case_afterhours','mxm_2800','mxm_coins','2 800 MXM',2800,2400,'rare','{}',true),
  ('case_afterhours','energy_80','energy','80 энергии',80,1600,'rare','{}',true),
  ('case_afterhours','afterhours_badge','profile_item','Значок After Hours',1,1300,'epic','{"itemKey":"afterhours_badge","duplicateMxm":2200}',true),
  ('case_afterhours','blue_hour_frame','profile_item','Рамка Blue Hour',1,1000,'epic','{"itemKey":"blue_hour_frame","duplicateMxm":4500}',true),
  ('case_afterhours','crimson_frame','profile_item','Рамка Crimson Regent',1,700,'epic','{"itemKey":"crimson_regent_frame","duplicateMxm":6200}',true),
  ('case_afterhours','singularity_frame','profile_item','Рамка Singularity',1,200,'legendary','{"itemKey":"singularity_frame","duplicateMxm":22000}',true),
  ('case_black_ice','mxm_1200','mxm_coins','1 200 MXM',1200,2600,'common','{}',true),
  ('case_black_ice','mxm_3500','mxm_coins','3 500 MXM',3500,2200,'rare','{}',true),
  ('case_black_ice','energy_100','energy','100 энергии',100,1400,'rare','{}',true),
  ('case_black_ice','black_ice_badge','profile_item','Значок Black Ice Protocol',1,1400,'epic','{"itemKey":"black_ice_badge","duplicateMxm":3000}',true),
  ('case_black_ice','black_ice_frame','profile_item','Рамка Black Ice',1,1300,'epic','{"itemKey":"black_ice_frame","duplicateMxm":6500}',true),
  ('case_black_ice','mxm_12000','mxm_coins','12 000 MXM',12000,800,'legendary','{}',true),
  ('case_black_ice','monolith_frame','profile_item','Рамка Monolith',1,300,'legendary','{"itemKey":"monolith_frame","duplicateMxm":18000}',true),
  ('case_exchange','mxm_1500','mxm_coins','1 500 MXM',1500,2600,'common','{}',true),
  ('case_exchange','mxm_4200','mxm_coins','4 200 MXM',4200,2200,'rare','{}',true),
  ('case_exchange','energy_100','energy','100 энергии',100,1300,'rare','{}',true),
  ('case_exchange','exchange_badge','profile_item','Значок Exchange Operator',1,1400,'epic','{"itemKey":"exchange_operator_badge","duplicateMxm":3500}',true),
  ('case_exchange','market_maker_frame','profile_item','Рамка Market Maker',1,1200,'legendary','{"itemKey":"market_maker_frame","duplicateMxm":12000}',true),
  ('case_exchange','silver_archive_frame','profile_item','Рамка Silver Archive',1,1000,'epic','{"itemKey":"silver_archive_frame","duplicateMxm":5200}',true),
  ('case_exchange','mxm_18000','mxm_coins','18 000 MXM',18000,300,'legendary','{}',true),
  ('case_monolith','mxm_5000','mxm_coins','5 000 MXM',5000,2500,'rare','{}',true),
  ('case_monolith','mxm_12000','mxm_coins','12 000 MXM',12000,2200,'epic','{}',true),
  ('case_monolith','monolith_badge','profile_item','Значок Monolith Keeper',1,1600,'epic','{"itemKey":"monolith_badge","duplicateMxm":4500}',true),
  ('case_monolith','monolith_frame','profile_item','Рамка Monolith',1,1500,'legendary','{"itemKey":"monolith_frame","duplicateMxm":18000}',true),
  ('case_monolith','cinder_frame','profile_item','Рамка Cinder Vault',1,1000,'legendary','{"itemKey":"cinder_vault_frame","duplicateMxm":21000}',true),
  ('case_monolith','mxm_30000','mxm_coins','30 000 MXM',30000,800,'legendary','{}',true),
  ('case_monolith','meridian_frame','profile_item','Рамка Meridian',1,400,'legendary','{"itemKey":"meridian_frame","duplicateMxm":24000}',true),
  ('case_dynasty','mxm_7000','mxm_coins','7 000 MXM',7000,2300,'rare','{}',true),
  ('case_dynasty','mxm_16000','mxm_coins','16 000 MXM',16000,2200,'epic','{}',true),
  ('case_dynasty','dynasty_badge','profile_item','Значок Dynasty Archive',1,1500,'epic','{"itemKey":"dynasty_badge","duplicateMxm":6500}',true),
  ('case_dynasty','dynasty_frame','profile_item','Рамка Dynasty',1,1700,'legendary','{"itemKey":"dynasty_frame","duplicateMxm":28000}',true),
  ('case_dynasty','market_maker_frame','profile_item','Рамка Market Maker',1,900,'legendary','{"itemKey":"market_maker_frame","duplicateMxm":12000}',true),
  ('case_dynasty','cinder_frame','profile_item','Рамка Cinder Vault',1,800,'legendary','{"itemKey":"cinder_vault_frame","duplicateMxm":21000}',true),
  ('case_dynasty','mxm_50000','mxm_coins','50 000 MXM',50000,600,'legendary','{}',true),
  ('case_singularity','mxm_10000','mxm_coins','10 000 MXM',10000,2200,'epic','{}',true),
  ('case_singularity','mxm_24000','mxm_coins','24 000 MXM',24000,2000,'epic','{}',true),
  ('case_singularity','singularity_badge','profile_item','Значок Singularity Witness',1,1400,'epic','{"itemKey":"singularity_badge","duplicateMxm":9000}',true),
  ('case_singularity','singularity_frame','profile_item','Рамка Singularity',1,1800,'legendary','{"itemKey":"singularity_frame","duplicateMxm":22000}',true),
  ('case_singularity','meridian_frame','profile_item','Рамка Meridian',1,1200,'legendary','{"itemKey":"meridian_frame","duplicateMxm":24000}',true),
  ('case_singularity','dynasty_frame','profile_item','Рамка Dynasty',1,800,'legendary','{"itemKey":"dynasty_frame","duplicateMxm":28000}',true),
  ('case_singularity','mxm_75000','mxm_coins','75 000 MXM',75000,600,'legendary','{}',true)
on conflict(case_sku,reward_key) do update set
  reward_kind=excluded.reward_kind,
  reward_label=excluded.reward_label,
  amount=excluded.amount,
  weight=excluded.weight,
  rarity=excluded.rarity,
  metadata=excluded.metadata,
  active=excluded.active;
