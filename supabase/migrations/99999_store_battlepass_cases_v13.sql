begin;

-- MXM v0.63 / Store + Cases + Battle Pass content expansion.
-- All products and rewards are closed-loop virtual content. Nothing here is
-- withdrawable or redeemable for money, TON, Telegram Stars or other assets.

-- ---------------------------------------------------------------------------
-- Expanded Stars catalogue. Database metadata remains authoritative.
-- ---------------------------------------------------------------------------

insert into public.store_products(sku,category,title,description,stars_price,reward_label,badge,sort_order,metadata,active) values
  ('mxm_micro','currency','Карманный набор','Небольшой запас MXM для первых покупок внутри игровой экономики.',25,'400 MXM',null,10,'{"mxmCoins":400,"highlights":["Быстрый старт","Для недорогих игровых предметов"]}'::jsonb,true),
  ('mxm_starter','currency','Стартовый набор','Базовый запас виртуальной валюты MXM для магазина и кейсов.',50,'1 000 MXM',null,20,'{"mxmCoins":1000,"highlights":["1 000 MXM","Подходит для первого кейса"]}'::jsonb,true),
  ('mxm_trader','currency','Набор трейдера','Расширенный запас MXM для активной торговли и коллекций.',180,'5 000 MXM','Популярно',30,'{"mxmCoins":5000,"highlights":["5 000 MXM","Несколько покупок без пополнения"]}'::jsonb,true),
  ('mxm_pro','currency','Набор PRO','Средний пакет MXM для регулярной игры и развития профиля.',390,'12 500 MXM','PRO',40,'{"mxmCoins":12500,"highlights":["12 500 MXM","Хорошо для рамок и кейсов"]}'::jsonb,true),
  ('mxm_whale','currency','Большой набор','Крупный запас MXM для коллекционеров и активного рынка.',650,'25 000 MXM','Выгодно',50,'{"mxmCoins":25000,"highlights":["25 000 MXM","Для крупных игровых покупок"]}'::jsonb,true),
  ('mxm_investor','currency','Инвестор','Большой виртуальный пакет для долгой игровой сессии.',1990,'100 000 MXM','XL',60,'{"mxmCoins":100000,"highlights":["100 000 MXM","Большой запас на сезон"]}'::jsonb,true),
  ('mxm_treasury','currency','Казначейство','Максимальный пакет виртуальной валюты MXM в текущем каталоге.',3490,'200 000 MXM','Максимум',70,'{"mxmCoins":200000,"highlights":["200 000 MXM","Максимальный пакет каталога"]}'::jsonb,true),
  ('premium_7d','membership','Премиум на неделю','7 дней премиум-возможностей: повышенный лимит энергии и ускоренное восстановление.',99,'Премиум на 7 дней',null,100,'{"entitlement":"premium","durationDays":7,"highlights":["150 максимальной энергии","Восстановление энергии в 2 раза быстрее","Ежедневно: 250 MXM + до 25 энергии"]}'::jsonb,true),
  ('premium_30d','membership','Премиум MXM','30 дней премиум-возможностей внутри игры.',299,'Премиум на 30 дней','Популярно',110,'{"entitlement":"premium","durationDays":30,"highlights":["150 максимальной энергии","Восстановление энергии в 2 раза быстрее","Ежедневно: 250 MXM + до 25 энергии"]}'::jsonb,true),
  ('premium_90d','membership','Премиум на сезон+','90 дней премиум-возможностей с теми же игровыми преимуществами.',749,'Премиум на 90 дней','90 дней',120,'{"entitlement":"premium","durationDays":90,"highlights":["90 дней доступа","150 максимальной энергии","Ежедневно: 250 MXM + до 25 энергии"]}'::jsonb,true),
  ('season_premium','season','Боевой пропуск MXM','Открывает премиальную дорожку всех 30 уровней текущего сезона. XP набирается игровой активностью.',199,'Премиальная ветка сезона','30 уровней',150,'{"entitlement":"season_pass","highlights":["30 уровней наград","Дополнительные кейсы и MXM","Эксклюзивные сезонные рамки"]}'::jsonb,true),
  ('case_starter','cases','Стартовый кейс','Базовая серия с MXM, энергией, значком и шансом получить рамку Carbon Black.',25,'1 стартовый кейс',null,200,'{"caseTier":"starter","quantity":1,"highlights":["5 типов наград","Редкое+ 32%","Ограниченный выпуск"]}'::jsonb,true),
  ('case_market','cases','Market Drop','Рыночная серия с повышенными MXM-наградами и рамкой Carbon Black.',45,'1 кейс Market Drop','Новинка',210,'{"caseTier":"starter","quantity":1,"highlights":["6 типов наград","Эпическое+ 8%","Лимит 60 000"]}'::jsonb,true),
  ('case_rare','cases','Редкий кейс','Редкая серия с увеличенными наградами и шансом на Aurora Glass.',79,'1 редкий кейс','Редкий',220,'{"caseTier":"rare","quantity":1,"highlights":["6 типов наград","Эпическое+ 43%","Лимит 25 000"]}'::jsonb,true),
  ('case_creator','cases','Creator Signal','Серия для авторов: крупные MXM-награды, авторский значок и рамка Royal Gold.',119,'1 кейс Creator Signal','Автор',230,'{"caseTier":"rare","quantity":1,"highlights":["6 типов наград","Эпическое+ 47%","Лимит 14 000"]}'::jsonb,true),
  ('case_legendary','cases','Легендарный кейс','Премиальная серия с крупными наградами и шансом на рамку Deep Space.',199,'1 легендарный кейс','Легендарный',240,'{"caseTier":"legendary","quantity":1,"highlights":["6 типов наград","Легендарное 29%","Лимит 5 000"]}'::jsonb,true),
  ('case_vault','cases','Vault 1800','Самая редкая текущая серия. Founder Edition, крупные MXM-награды и лимитированный тираж.',349,'1 кейс Vault 1800','1 800 шт.',250,'{"caseTier":"legendary","quantity":1,"highlights":["6 типов наград","Легендарное 34%","Тираж 1 800"]}'::jsonb,true),
  ('energy_refill','energy','Полная энергия','Мгновенно восстанавливает игровую энергию до текущего максимума.',20,'Полная энергия',null,300,'{"energyRefill":true,"highlights":["До полного запаса","Премиум-лимит учитывается автоматически"]}'::jsonb,true),
  ('creator_boost_6h','creator','Импульс мемкоина','Выделяет один активный мемкоин автора в витрине на 6 часов.',39,'Продвижение на 6 часов',null,400,'{"creatorTool":"boost","durationHours":6,"requiresCoin":true,"highlights":["6 часов продвижения","Только для своего активного мемкоина"]}'::jsonb,true),
  ('creator_boost_24h','creator','Продвижение мемкоина','Выделяет один мемкоин автора на 24 часа.',99,'Продвижение на 24 часа','Популярно',410,'{"creatorTool":"boost","durationHours":24,"requiresCoin":true,"highlights":["24 часа продвижения","Периоды суммируются для выбранного коина"]}'::jsonb,true),
  ('creator_boost_72h','creator','Турбо-продвижение','Продвижение одного мемкоина автора на 72 часа.',249,'Продвижение на 72 часа','72 часа',420,'{"creatorTool":"boost","durationHours":72,"requiresCoin":true,"highlights":["72 часа продвижения","Для длительной кампании"]}'::jsonb,true),
  ('creator_verified_7d','creator','Проверенный автор · 7 дней','Внутренний статус проверенного автора на 7 дней.',119,'Проверка на 7 дней',null,430,'{"entitlement":"creator_verified","durationDays":7,"highlights":["Статус внутри MXM","7 дней"]}'::jsonb,true),
  ('creator_verified_30d','creator','Проверенный автор','Статус проверенного автора на 30 дней внутри приложения.',349,'Проверка на 30 дней','Проверено',440,'{"entitlement":"creator_verified","durationDays":30,"highlights":["Статус внутри MXM","30 дней"]}'::jsonb,true),
  ('creator_verified_90d','creator','Проверенный автор · 90 дней','Длительный внутренний статус проверенного автора.',899,'Проверка на 90 дней','90 дней',450,'{"entitlement":"creator_verified","durationDays":90,"highlights":["Статус внутри MXM","90 дней"]}'::jsonb,true),
  ('creator_analytics_7d','creator','Аналитика · 7 дней','Расширенная внутриигровая аналитика автора на неделю.',89,'Аналитика на 7 дней',null,460,'{"entitlement":"creator_analytics","durationDays":7,"highlights":["Расширенные метрики автора","7 дней"]}'::jsonb,true),
  ('creator_analytics_30d','creator','Расширенная аналитика','Расширенная аналитика автора на 30 дней.',249,'Аналитика на 30 дней','30 дней',470,'{"entitlement":"creator_analytics","durationDays":30,"highlights":["Расширенные метрики автора","30 дней"]}'::jsonb,true),
  ('creator_analytics_90d','creator','Аналитика PRO · 90 дней','Длительный доступ к расширенной аналитике автора.',649,'Аналитика на 90 дней','PRO',480,'{"entitlement":"creator_analytics","durationDays":90,"highlights":["Расширенные метрики автора","90 дней"]}'::jsonb,true),
  ('profile_carbon_frame','profile','Carbon Black','Матовая карбоновая рамка профиля с фактурной окантовкой.',49,'Рамка Carbon Black',null,500,'{"profileItem":"carbon_frame","itemType":"frame","highlights":["Постоянный предмет","Редкость: обычная"]}'::jsonb,true),
  ('profile_chrome_frame','profile','Liquid Chrome','Металлическая рамка с холодным хромированным бликом.',69,'Рамка Liquid Chrome','Редкая',510,'{"profileItem":"chrome_frame","itemType":"frame","highlights":["Постоянный предмет","Редкость: редкая"]}'::jsonb,true),
  ('profile_frost_frame','profile','Arctic Frost','Холодная стеклянная рамка в ледяной палитре.',79,'Рамка Arctic Frost','Редкая',520,'{"profileItem":"frost_frame","itemType":"frame","highlights":["Постоянный предмет","Редкость: редкая"]}'::jsonb,true),
  ('profile_sunset_frame','profile','Solar Sunset','Тёплая градиентная рамка с закатным металлизированным контуром.',89,'Рамка Solar Sunset','Эпическая',530,'{"profileItem":"sunset_frame","itemType":"frame","highlights":["Постоянный предмет","Редкость: эпическая"]}'::jsonb,true),
  ('profile_neon_frame','profile','Spectrum Legacy','Обновлённая версия оригинальной рамки MXM для владельцев старого предмета.',89,'Рамка Spectrum Legacy','Legacy',540,'{"profileItem":"neon_frame","itemType":"frame","highlights":["Совместима со старым предметом","Редкость: эпическая"]}'::jsonb,true),
  ('profile_aurora_frame','profile','Aurora Glass','Переливающаяся стеклянная рамка с холодным спектром.',109,'Рамка Aurora Glass','Эпическая',550,'{"profileItem":"aurora_frame","itemType":"frame","highlights":["Постоянный предмет","Редкость: эпическая"]}'::jsonb,true),
  ('profile_royal_frame','profile','Royal Gold','Золотая рамка с отдельным декоративным гребнем.',149,'Рамка Royal Gold','Легендарная',560,'{"profileItem":"royal_frame","itemType":"frame","highlights":["Постоянный предмет","Редкость: легендарная"]}'::jsonb,true),
  ('profile_void_frame','profile','Deep Space','Тёмная космическая рамка со звёздными акцентами.',179,'Рамка Deep Space','Легендарная',570,'{"profileItem":"void_frame","itemType":"frame","highlights":["Постоянный предмет","Редкость: легендарная"]}'::jsonb,true),
  ('profile_founder_frame','profile','Founder Edition','Самая дорогая рамка каталога: металл, тёмный графит и золотой акцент.',299,'Рамка Founder Edition','Founder',580,'{"profileItem":"founder_frame","itemType":"frame","highlights":["Постоянный предмет","Редкость: легендарная"]}'::jsonb,true)
on conflict(sku) do update set
  category=excluded.category,title=excluded.title,description=excluded.description,stars_price=excluded.stars_price,
  reward_label=excluded.reward_label,badge=excluded.badge,sort_order=excluded.sort_order,metadata=excluded.metadata,
  active=excluded.active,updated_at=now();

-- Real cosmetic inventory used by store, cases and season rewards.
insert into public.profile_items(item_key,item_type,title,rarity,metadata,active) values
  ('carbon_frame','frame','Carbon Black','common','{"source":"store"}'::jsonb,true),
  ('chrome_frame','frame','Liquid Chrome','rare','{"source":"store"}'::jsonb,true),
  ('frost_frame','frame','Arctic Frost','rare','{"source":"store"}'::jsonb,true),
  ('sunset_frame','frame','Solar Sunset','epic','{"source":"store"}'::jsonb,true),
  ('neon_frame','frame','Spectrum Legacy','epic','{"source":"store","legacy":true}'::jsonb,true),
  ('aurora_frame','frame','Aurora Glass','epic','{"source":"store_case"}'::jsonb,true),
  ('royal_frame','frame','Royal Gold','legendary','{"source":"store_case"}'::jsonb,true),
  ('void_frame','frame','Deep Space','legendary','{"source":"store_case"}'::jsonb,true),
  ('founder_frame','frame','Founder Edition','legendary','{"source":"store_case"}'::jsonb,true),
  ('season_rift_frame','frame','Season Rift','epic','{"source":"season"}'::jsonb,true),
  ('season_master_frame','frame','Season Master','legendary','{"source":"season"}'::jsonb,true),
  ('market_runner_badge','badge','Market Runner','rare','{"source":"case"}'::jsonb,true),
  ('creator_signal_badge','badge','Creator Signal','epic','{"source":"case"}'::jsonb,true),
  ('vault_keeper_badge','badge','Vault Keeper','legendary','{"source":"case"}'::jsonb,true),
  ('season_15_badge','badge','Лига XV','rare','{"source":"season"}'::jsonb,true),
  ('season_30_badge','badge','Лига XXX','legendary','{"source":"season"}'::jsonb,true)
on conflict(item_key) do update set item_type=excluded.item_type,title=excluded.title,rarity=excluded.rarity,metadata=excluded.metadata,active=true;

-- New case series. Existing remaining_supply is deliberately preserved on
-- re-run so a migration can never refill an already sold limited series.
insert into public.case_definitions(sku,title,tier,description,remaining_supply,active) values
  ('case_starter','Стартовый кейс','starter','Базовая серия: MXM, энергия, коллекционный значок и шанс на Carbon Black.',100000,true),
  ('case_market','Market Drop','starter','Рыночная серия с шестью наградами, повышенным MXM и шансом на Carbon Black.',60000,true),
  ('case_rare','Редкий кейс','rare','Редкая серия с крупными наградами, Liquid Chrome и шансом на Aurora Glass.',25000,true),
  ('case_creator','Creator Signal','rare','Авторская серия с Creator Signal, Aurora Glass и шансом на Royal Gold.',14000,true),
  ('case_legendary','Легендарный кейс','legendary','Премиальная серия с крупными MXM-наградами, Royal Gold и шансом на Deep Space.',5000,true),
  ('case_vault','Vault 1800','legendary','Лимитированный выпуск из 1 800 кейсов с шансом на Founder Edition.',1800,true)
on conflict(sku) do update set title=excluded.title,tier=excluded.tier,description=excluded.description,active=true;

update public.case_loot_definitions set active=false where case_sku in ('case_starter','case_market','case_rare','case_creator','case_legendary','case_vault');

insert into public.case_loot_definitions(case_sku,reward_key,reward_kind,reward_label,amount,weight,rarity,metadata,active) values
  ('case_starter','mxm_100','mxm_coins','100 MXM',100,4200,'common','{}'::jsonb,true),
  ('case_starter','energy_25','energy','25 энергии (излишек: 5 MXM за единицу)',25,2600,'common','{}'::jsonb,true),
  ('case_starter','mxm_250','mxm_coins','250 MXM',250,1800,'rare','{}'::jsonb,true),
  ('case_starter','pixel_badge','profile_item','Значок «Пиксельный первопроходец» (дубликат: 250 MXM)',1,1000,'rare','{"itemKey":"case_pixel_badge","duplicateMxm":250}'::jsonb,true),
  ('case_starter','carbon_frame','profile_item','Рамка Carbon Black (дубликат: 1 500 MXM)',1,400,'epic','{"itemKey":"carbon_frame","duplicateMxm":1500}'::jsonb,true),
  ('case_market','mxm_250','mxm_coins','250 MXM',250,3500,'common','{}'::jsonb,true),
  ('case_market','energy_40','energy','40 энергии (излишек: 5 MXM за единицу)',40,2200,'common','{}'::jsonb,true),
  ('case_market','mxm_600','mxm_coins','600 MXM',600,2300,'rare','{}'::jsonb,true),
  ('case_market','market_runner','profile_item','Значок Market Runner (дубликат: 700 MXM)',1,1200,'rare','{"itemKey":"market_runner_badge","duplicateMxm":700}'::jsonb,true),
  ('case_market','carbon_frame','profile_item','Рамка Carbon Black (дубликат: 1 500 MXM)',1,600,'epic','{"itemKey":"carbon_frame","duplicateMxm":1500}'::jsonb,true),
  ('case_market','mxm_1800','mxm_coins','1 800 MXM',1800,200,'legendary','{}'::jsonb,true),
  ('case_rare','mxm_700','mxm_coins','700 MXM',700,3500,'common','{}'::jsonb,true),
  ('case_rare','energy_75','energy','75 энергии (излишек: 5 MXM за единицу)',75,2200,'rare','{}'::jsonb,true),
  ('case_rare','rare_badge','profile_item','Значок «Редкий сигнал» (дубликат: 1 000 MXM)',1,1700,'epic','{"itemKey":"case_rare_badge","duplicateMxm":1000}'::jsonb,true),
  ('case_rare','chrome_frame','profile_item','Рамка Liquid Chrome (дубликат: 2 500 MXM)',1,1200,'epic','{"itemKey":"chrome_frame","duplicateMxm":2500}'::jsonb,true),
  ('case_rare','mxm_3500','mxm_coins','3 500 MXM',3500,1200,'legendary','{}'::jsonb,true),
  ('case_rare','aurora_frame','profile_item','Рамка Aurora Glass (дубликат: 4 500 MXM)',1,200,'legendary','{"itemKey":"aurora_frame","duplicateMxm":4500}'::jsonb,true),
  ('case_creator','mxm_1000','mxm_coins','1 000 MXM',1000,3200,'common','{}'::jsonb,true),
  ('case_creator','energy_100','energy','100 энергии (излишек: 5 MXM за единицу)',100,2100,'rare','{}'::jsonb,true),
  ('case_creator','creator_signal','profile_item','Значок Creator Signal (дубликат: 2 000 MXM)',1,1800,'epic','{"itemKey":"creator_signal_badge","duplicateMxm":2000}'::jsonb,true),
  ('case_creator','aurora_frame','profile_item','Рамка Aurora Glass (дубликат: 4 500 MXM)',1,1300,'epic','{"itemKey":"aurora_frame","duplicateMxm":4500}'::jsonb,true),
  ('case_creator','mxm_5000','mxm_coins','5 000 MXM',5000,1400,'legendary','{}'::jsonb,true),
  ('case_creator','royal_frame','profile_item','Рамка Royal Gold (дубликат: 7 000 MXM)',1,200,'legendary','{"itemKey":"royal_frame","duplicateMxm":7000}'::jsonb,true),
  ('case_legendary','mxm_2500','mxm_coins','2 500 MXM',2500,3500,'rare','{}'::jsonb,true),
  ('case_legendary','energy_150','energy','150 энергии (излишек: 5 MXM за единицу)',150,1900,'epic','{}'::jsonb,true),
  ('case_legendary','legend_badge','profile_item','Значок «Легенда рынка» (дубликат: 5 000 MXM)',1,1700,'epic','{"itemKey":"case_legend_badge","duplicateMxm":5000}'::jsonb,true),
  ('case_legendary','royal_frame','profile_item','Рамка Royal Gold (дубликат: 7 000 MXM)',1,1400,'legendary','{"itemKey":"royal_frame","duplicateMxm":7000}'::jsonb,true),
  ('case_legendary','mxm_12000','mxm_coins','12 000 MXM',12000,1300,'legendary','{}'::jsonb,true),
  ('case_legendary','void_frame','profile_item','Рамка Deep Space (дубликат: 9 000 MXM)',1,200,'legendary','{"itemKey":"void_frame","duplicateMxm":9000}'::jsonb,true),
  ('case_vault','mxm_5000','mxm_coins','5 000 MXM',5000,3200,'rare','{}'::jsonb,true),
  ('case_vault','energy_250','energy','250 энергии (излишек: 5 MXM за единицу)',250,1700,'epic','{}'::jsonb,true),
  ('case_vault','vault_keeper','profile_item','Значок Vault Keeper (дубликат: 5 000 MXM)',1,1700,'epic','{"itemKey":"vault_keeper_badge","duplicateMxm":5000}'::jsonb,true),
  ('case_vault','royal_frame','profile_item','Рамка Royal Gold (дубликат: 7 000 MXM)',1,1500,'legendary','{"itemKey":"royal_frame","duplicateMxm":7000}'::jsonb,true),
  ('case_vault','mxm_25000','mxm_coins','25 000 MXM',25000,1600,'legendary','{}'::jsonb,true),
  ('case_vault','founder_frame','profile_item','Рамка Founder Edition (дубликат: 15 000 MXM)',1,300,'legendary','{"itemKey":"founder_frame","duplicateMxm":15000}'::jsonb,true)
on conflict(case_sku,reward_key) do update set reward_kind=excluded.reward_kind,reward_label=excluded.reward_label,amount=excluded.amount,weight=excluded.weight,rarity=excluded.rarity,metadata=excluded.metadata,active=true;

-- Concrete MXM sinks keep free progression meaningful as well as paid Stars.
insert into public.mxm_sink_products(sku,mxm_price,active,sort_order) values
  ('case_starter',1400,true,10),
  ('case_market',2500,true,20),
  ('case_rare',4400,true,30),
  ('case_creator',7000,true,40),
  ('case_legendary',11000,true,50),
  ('case_vault',20000,true,60),
  ('energy_refill',1100,true,70),
  ('profile_carbon_frame',3000,true,100),
  ('profile_chrome_frame',4500,true,110),
  ('profile_frost_frame',5500,true,120),
  ('profile_sunset_frame',6500,true,130),
  ('profile_neon_frame',4900,true,140),
  ('profile_aurora_frame',8500,true,150),
  ('profile_royal_frame',11500,true,160),
  ('profile_void_frame',15000,true,170),
  ('profile_founder_frame',28000,true,180)
on conflict(sku) do update set mxm_price=excluded.mxm_price,active=true,sort_order=excluded.sort_order,updated_at=now();

-- ---------------------------------------------------------------------------
-- Thirty-level battle pass. Levels 1–10 deliberately retain the v2.00
-- thresholds/rewards so already-claimed production rewards never change meaning.
-- Levels 11–30 extend the immutable template and the current active season.
-- ---------------------------------------------------------------------------
update public.seasons set title='Сезон MXM: Первая лига'
where season_key='market-2-launch' or (active=true and now()>=starts_at and now()<ends_at);

with target_seasons as (
  select id from public.seasons where season_key='market-2-launch'
  union
  select id from public.seasons where active=true and now()>=starts_at and now()<ends_at
), rewards(level,track,required_xp,reward_kind,reward_label,amount,metadata) as (values
  (1,'free',0,'mxm_coins','100 MXM',100,'{}'::jsonb),
  (1,'premium',0,'mxm_coins','500 MXM',500,'{}'::jsonb),
  (2,'free',20,'energy','25 энергии',25,'{}'::jsonb),
  (2,'premium',20,'case','Стартовый кейс',1,'{"sku":"case_starter"}'::jsonb),
  (3,'free',50,'mxm_coins','250 MXM',250,'{}'::jsonb),
  (3,'premium',50,'mxm_coins','1 000 MXM',1000,'{}'::jsonb),
  (4,'free',90,'case','Стартовый кейс',1,'{"sku":"case_starter"}'::jsonb),
  (4,'premium',90,'energy','100 энергии',100,'{}'::jsonb),
  (5,'free',140,'mxm_coins','500 MXM',500,'{}'::jsonb),
  (5,'premium',140,'case','Редкий кейс',1,'{"sku":"case_rare"}'::jsonb),
  (6,'free',200,'energy','50 энергии',50,'{}'::jsonb),
  (6,'premium',200,'mxm_coins','2 000 MXM',2000,'{}'::jsonb),
  (7,'free',275,'mxm_coins','750 MXM',750,'{}'::jsonb),
  (7,'premium',275,'case','Редкий кейс',1,'{"sku":"case_rare"}'::jsonb),
  (8,'free',365,'case','Стартовый кейс',1,'{"sku":"case_starter"}'::jsonb),
  (8,'premium',365,'mxm_coins','3 000 MXM',3000,'{}'::jsonb),
  (9,'free',470,'mxm_coins','1 000 MXM',1000,'{}'::jsonb),
  (9,'premium',470,'energy','150 энергии',150,'{}'::jsonb),
  (10,'free',600,'case','Редкий кейс',1,'{"sku":"case_rare"}'::jsonb),
  (10,'premium',600,'case','Легендарный кейс',1,'{"sku":"case_legendary"}'::jsonb),
  (11,'free',660,'energy','40 энергии',40,'{}'::jsonb),
  (11,'premium',660,'mxm_coins','1 200 MXM',1200,'{}'::jsonb),
  (12,'free',720,'mxm_coins','450 MXM',450,'{}'::jsonb),
  (12,'premium',720,'case','Редкий кейс',1,'{"sku":"case_rare"}'::jsonb),
  (13,'free',780,'case','Market Drop',1,'{"sku":"case_market"}'::jsonb),
  (13,'premium',780,'energy','125 энергии',125,'{}'::jsonb),
  (14,'free',840,'mxm_coins','500 MXM',500,'{}'::jsonb),
  (14,'premium',840,'mxm_coins','1 500 MXM',1500,'{}'::jsonb),
  (15,'free',900,'profile_item','Значок «Лига XV»',1,'{"itemKey":"season_15_badge","duplicateMxm":1200}'::jsonb),
  (15,'premium',900,'profile_item','Рамка Season Rift',1,'{"itemKey":"season_rift_frame","duplicateMxm":5000}'::jsonb),
  (16,'free',960,'energy','50 энергии',50,'{}'::jsonb),
  (16,'premium',960,'case','Creator Signal',1,'{"sku":"case_creator"}'::jsonb),
  (17,'free',1020,'mxm_coins','600 MXM',600,'{}'::jsonb),
  (17,'premium',1020,'mxm_coins','1 750 MXM',1750,'{}'::jsonb),
  (18,'free',1080,'case','Редкий кейс',1,'{"sku":"case_rare"}'::jsonb),
  (18,'premium',1080,'energy','150 энергии',150,'{}'::jsonb),
  (19,'free',1140,'mxm_coins','700 MXM',700,'{}'::jsonb),
  (19,'premium',1140,'case','Редкий кейс',1,'{"sku":"case_rare"}'::jsonb),
  (20,'free',1200,'case','Market Drop',1,'{"sku":"case_market"}'::jsonb),
  (20,'premium',1200,'mxm_coins','2 000 MXM',2000,'{}'::jsonb),
  (21,'free',1260,'energy','75 энергии',75,'{}'::jsonb),
  (21,'premium',1260,'case','Creator Signal',1,'{"sku":"case_creator"}'::jsonb),
  (22,'free',1320,'mxm_coins','800 MXM',800,'{}'::jsonb),
  (22,'premium',1320,'mxm_coins','2 250 MXM',2250,'{}'::jsonb),
  (23,'free',1380,'case','Редкий кейс',1,'{"sku":"case_rare"}'::jsonb),
  (23,'premium',1380,'energy','200 энергии',200,'{}'::jsonb),
  (24,'free',1440,'mxm_coins','900 MXM',900,'{}'::jsonb),
  (24,'premium',1440,'case','Легендарный кейс',1,'{"sku":"case_legendary"}'::jsonb),
  (25,'free',1500,'mxm_coins','1 000 MXM',1000,'{}'::jsonb),
  (25,'premium',1500,'mxm_coins','3 000 MXM',3000,'{}'::jsonb),
  (26,'free',1560,'case','Market Drop',1,'{"sku":"case_market"}'::jsonb),
  (26,'premium',1560,'profile_item','Значок «Лига XXX»',1,'{"itemKey":"season_30_badge","duplicateMxm":3500}'::jsonb),
  (27,'free',1620,'energy','100 энергии',100,'{}'::jsonb),
  (27,'premium',1620,'case','Легендарный кейс',1,'{"sku":"case_legendary"}'::jsonb),
  (28,'free',1680,'case','Редкий кейс',1,'{"sku":"case_rare"}'::jsonb),
  (28,'premium',1680,'mxm_coins','4 000 MXM',4000,'{}'::jsonb),
  (29,'free',1740,'mxm_coins','1 500 MXM',1500,'{}'::jsonb),
  (29,'premium',1740,'case','Vault 1800',1,'{"sku":"case_vault"}'::jsonb),
  (30,'free',1800,'profile_item','Рамка Season Rift',1,'{"itemKey":"season_rift_frame","duplicateMxm":5000}'::jsonb),
  (30,'premium',1800,'profile_item','Рамка Season Master',1,'{"itemKey":"season_master_frame","duplicateMxm":12000}'::jsonb)
)
insert into public.season_rewards(season_id,level,track,required_xp,reward_kind,reward_label,amount,metadata)
select s.id,r.level,r.track,r.required_xp,r.reward_kind,r.reward_label,r.amount,r.metadata
from target_seasons s cross join rewards r
on conflict(season_id,level,track) do update set required_xp=excluded.required_xp,reward_kind=excluded.reward_kind,reward_label=excluded.reward_label,amount=excluded.amount,metadata=excluded.metadata;

with target_seasons as (
  select id from public.seasons where season_key='market-2-launch'
  union
  select id from public.seasons where active=true and now()>=starts_at and now()<ends_at
)
delete from public.season_rewards sr using target_seasons s where sr.season_id=s.id and sr.level>30;


-- Future seasons keep the v0.63 title and copy the 30-level template.
create or replace function public.ensure_current_season_v200()
returns uuid language plpgsql security definer set search_path=public as $$
declare v_current uuid; v_source uuid; v_start timestamptz:=date_trunc('day',now());
begin
  perform pg_advisory_xact_lock(hashtextextended('mxm-current-season-v200',0));
  select id into v_current from public.seasons where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if v_current is not null then return v_current; end if;
  update public.seasons set active=false where active=true and ends_at<=now();
  select id into v_source from public.seasons where season_key='market-2-launch';
  if v_source is null then raise exception 'Season reward template is missing'; end if;
  insert into public.seasons(season_key,title,starts_at,ends_at,active)
  values('season-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),'Сезон MXM: '||to_char(v_start,'YYYY-MM'),v_start,v_start+interval '30 days',true)
  returning id into v_current;
  insert into public.season_rewards(season_id,level,track,required_xp,reward_kind,reward_label,amount,metadata)
  select v_current,level,track,required_xp,reward_kind,reward_label,amount,metadata
  from public.season_rewards where season_id=v_source;
  return v_current;
end;
$$;

-- Any source can safely grant profile cosmetics. A duplicate now always turns
-- into the declared MXM compensation, including concurrent grants.
create or replace function public.grant_virtual_reward_v200(
  p_profile_id uuid,
  p_kind text,
  p_amount integer,
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'system',
  p_reference_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_item_key text;
  v_sku text;
  v_profile public.profiles;
  v_energy_credit integer:=0;
  v_overflow integer:=0;
  v_overflow_mxm bigint:=0;
  v_duplicate_unit bigint:=500;
  v_duplicate_mxm bigint:=0;
  v_inserted integer:=0;
begin
  if p_amount is null or p_amount<=0 then raise exception 'Reward amount must be positive'; end if;
  if p_kind='energy' then perform public.refresh_profile_energy_v200(p_profile_id); end if;
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;

  if p_kind='mxm_coins' then
    update public.profiles set mxm_coins=mxm_coins+p_amount,updated_at=now() where id=p_profile_id;
  elsif p_kind='energy' then
    v_energy_credit:=least(p_amount,greatest(0,v_profile.max_energy-v_profile.energy));
    v_overflow:=p_amount-v_energy_credit;
    v_overflow_mxm:=v_overflow::bigint*5;
    update public.profiles set energy=energy+v_energy_credit,mxm_coins=mxm_coins+v_overflow_mxm,
      energy_updated_at=now(),updated_at=now() where id=p_profile_id;
  elsif p_kind='case' then
    v_sku:=nullif(p_metadata->>'sku','');
    if v_sku is null or not exists(select 1 from public.case_definitions where sku=v_sku and active=true) then
      raise exception 'Case reward is invalid';
    end if;
    insert into public.profile_inventory(profile_id,sku,quantity)
    values(p_profile_id,v_sku,p_amount)
    on conflict(profile_id,sku) do update set quantity=public.profile_inventory.quantity+excluded.quantity,updated_at=now();
  elsif p_kind='profile_item' then
    v_item_key:=nullif(p_metadata->>'itemKey','');
    if v_item_key is null or not exists(select 1 from public.profile_items where item_key=v_item_key and active=true) then
      raise exception 'Profile item reward is invalid';
    end if;
    if coalesce(p_metadata->>'duplicateMxm','') ~ '^[0-9]{1,7}$' then
      v_duplicate_unit:=greatest(0,least(1000000,(p_metadata->>'duplicateMxm')::bigint));
    end if;
    insert into public.profile_item_inventory(profile_id,item_key,source,source_reference)
    values(p_profile_id,v_item_key,left(coalesce(nullif(p_source,''),'system'),40),p_reference_id)
    on conflict(profile_id,item_key) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted=0 then
      v_duplicate_mxm:=v_duplicate_unit*p_amount;
    elsif p_amount>1 then
      v_duplicate_mxm:=v_duplicate_unit*(p_amount-1);
    end if;
    if v_duplicate_mxm>0 then
      update public.profiles set mxm_coins=mxm_coins+v_duplicate_mxm,updated_at=now() where id=p_profile_id;
    end if;
  else
    raise exception 'Unsupported virtual reward kind';
  end if;

  if p_kind='profile_item' and v_inserted=0 then
    return jsonb_build_object('kind','mxm_coins','amount',v_duplicate_mxm,'duplicateItemKey',v_item_key,
      'creditedEnergy',null,'overflowMxmCoins',v_duplicate_mxm,
      'label',v_duplicate_mxm::text||' MXM duplicate compensation');
  end if;

  return jsonb_build_object(
    'kind',case when p_kind='energy' and v_energy_credit=0 then 'mxm_coins' else p_kind end,
    'amount',case when p_kind='energy' and v_energy_credit=0 then v_overflow_mxm
      when p_kind='energy' then v_energy_credit else p_amount end,
    'creditedEnergy',case when p_kind='energy' then v_energy_credit else null end,
    'overflowMxmCoins',case when p_kind='energy' then v_overflow_mxm
      when p_kind='profile_item' then v_duplicate_mxm else 0 end,
    'label',case when p_kind='energy' and v_overflow>0 then
      v_energy_credit::text||' Energy + '||v_overflow_mxm::text||' MXM overflow compensation'
    when p_kind='profile_item' and v_duplicate_mxm>0 then
      coalesce(nullif(p_metadata->>'label',''),v_item_key)||' + '||v_duplicate_mxm::text||' MXM duplicate compensation'
    else coalesce(nullif(p_metadata->>'label',''),
      case p_kind when 'mxm_coins' then p_amount::text||' MXM'
                  when 'energy' then p_amount::text||' Energy'
                  when 'case' then p_amount::text||' case'
                  else coalesce(v_item_key,'Profile item') end) end
  );
end;
$$;

-- Expire abandoned invoice links as well as releasing stale authorized value.
-- Older code only released authorized reservations, so cancelled/abandoned
-- invoices could remain `pending` forever even though their expires_at elapsed.
create or replace function public.release_expired_star_authorizations_v200(p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_purchase public.star_purchases;
  v_released integer:=0;
  v_pending_expired integer:=0;
  v_quantity integer;
  v_limit integer:=greatest(1,least(coalesce(p_limit,200),1000));
begin
  with stale as (
    select id from public.star_purchases
    where status='pending' and expires_at is not null and expires_at<now()
    order by expires_at for update skip locked limit v_limit
  )
  update public.star_purchases sp set status='expired',updated_at=now()
  from stale where sp.id=stale.id;
  get diagnostics v_pending_expired = row_count;

  for v_purchase in select * from public.star_purchases
    -- Keep the existing successful_payment grace period for pre-checkout
    -- reservations: Telegram can finalize a charged payment slightly later.
    where status='authorized' and expires_at<now()-interval '15 minutes'
    order by expires_at for update skip locked limit v_limit
  loop
    if coalesce((v_purchase.reserved_grant->>'caseStockReserved')::boolean,false) then
      v_quantity:=greatest(1,coalesce((v_purchase.reserved_grant->>'quantity')::integer,1));
      update public.case_definitions set remaining_supply=remaining_supply+v_quantity
      where sku=v_purchase.product_sku and remaining_supply is not null;
    end if;
    update public.star_purchases set status='expired',reservation_released_at=now(),updated_at=now() where id=v_purchase.id;
    v_released:=v_released+1;
  end loop;
  return jsonb_build_object('released',v_released,'expiredPending',v_pending_expired,'total',v_released+v_pending_expired);
end;
$$;

-- One atomic API action can collect every currently unlocked unclaimed reward.
create or replace function public.claim_all_season_rewards_v300(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_season public.seasons;
  v_xp integer:=0;
  v_premium boolean:=false;
  v_row record;
  v_claim jsonb;
  v_rewards jsonb:='[]'::jsonb;
  v_count integer:=0;
begin
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  perform public.ensure_current_season_v200();
  select * into v_season from public.seasons
  where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if not found then raise exception 'No active season'; end if;
  select coalesce(sum(amount),0)::integer into v_xp from public.profile_xp_events
  where profile_id=p_profile_id and created_at>=v_season.starts_at and created_at<v_season.ends_at;
  select exists(select 1 from public.profile_entitlements
    where profile_id=p_profile_id and entitlement_key='season_pass' and (expires_at is null or expires_at>now())) into v_premium;

  for v_row in
    select sr.level,sr.track
    from public.season_rewards sr
    where sr.season_id=v_season.id and sr.required_xp<=v_xp
      and (sr.track='free' or v_premium)
      and not exists(select 1 from public.season_claims sc
        where sc.profile_id=p_profile_id and sc.season_id=sr.season_id and sc.level=sr.level and sc.track=sr.track)
    order by sr.level,case sr.track when 'free' then 0 else 1 end
  loop
    v_claim:=public.claim_season_reward_v200(p_profile_id,v_row.level,v_row.track);
    v_rewards:=v_rewards||jsonb_build_array(jsonb_build_object('level',v_row.level,'track',v_row.track,'result',v_claim));
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('status','claimed','claimedCount',v_count,'rewards',v_rewards,'xp',v_xp,'premium',v_premium);
end;
$$;

-- Stable display order for all six case series: the shop sort order is the
-- source of truth, not incidental table order inside the same tier.
create or replace function public.case_snapshot_v200(p_profile_id uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'cases',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku',d.sku,'title',d.title,'tier',d.tier,'description',d.description,
        'quantity',coalesce(i.quantity,0),'remaining',d.remaining_supply,
        'odds',coalesce((
          select jsonb_agg(jsonb_build_object(
            'reward',l.reward_key,'label',l.reward_label,
            'percent',round(100.0*l.weight/nullif((select sum(l2.weight) from public.case_loot_definitions l2
              where l2.case_sku=d.sku and l2.active=true),0),2),'rarity',l.rarity
          ) order by l.weight desc,l.reward_key)
          from public.case_loot_definitions l where l.case_sku=d.sku and l.active=true
        ),'[]'::jsonb)
      ) order by coalesce(sp.sort_order,999999),d.sku)
      from public.case_definitions d
      left join public.store_products sp on sp.sku=d.sku
      left join public.profile_inventory i on i.profile_id=p_profile_id and i.sku=d.sku
      where d.active=true
    ),'[]'::jsonb),
    'history',coalesce((
      select jsonb_agg(jsonb_build_object('id',o.id,'caseSku',o.case_sku,'rewardLabel',o.reward_label,
        'rarity',o.rarity,'openedAt',o.opened_at) order by o.opened_at desc)
      from (select * from public.case_openings where profile_id=p_profile_id order by opened_at desc limit 30) o
    ),'[]'::jsonb)
  );
$$;

revoke execute on function public.claim_all_season_rewards_v300(uuid) from public,anon,authenticated;
grant execute on function public.claim_all_season_rewards_v300(uuid) to service_role;

-- Reassert service-role boundaries for replaced functions.
revoke execute on function public.ensure_current_season_v200() from public,anon,authenticated;
revoke execute on function public.grant_virtual_reward_v200(uuid,text,integer,jsonb,text,uuid) from public,anon,authenticated;
revoke execute on function public.release_expired_star_authorizations_v200(integer) from public,anon,authenticated;
revoke execute on function public.case_snapshot_v200(uuid) from public,anon,authenticated;
grant execute on function public.ensure_current_season_v200(),
  public.grant_virtual_reward_v200(uuid,text,integer,jsonb,text,uuid),
  public.release_expired_star_authorizations_v200(integer),
  public.case_snapshot_v200(uuid) to service_role;

commit;
