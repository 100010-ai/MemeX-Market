begin;

-- Production UI copy cleanup. Internal identifiers stay unchanged; only the
-- persisted strings rendered to players are localized and normalized.

update public.store_products
set title = v.title,
    description = v.description,
    reward_label = v.reward_label,
    badge = v.badge,
    updated_at = now()
from (values
  ('mxm_starter','Стартовый набор','Виртуальная валюта для внутренней игровой экономики MXM.','1 000 MXM',null::text),
  ('mxm_trader','Набор трейдера','Виртуальная валюта для внутренней игровой экономики MXM.','5 000 MXM','+10%'),
  ('mxm_whale','Большой набор','Виртуальная валюта для внутренней игровой экономики MXM.','25 000 MXM','Выгодно'),
  ('mxm_investor','Максимальный набор','Виртуальная валюта для внутренней игровой экономики MXM.','100 000 MXM','Максимум'),
  ('premium_30d','Премиум MXM','30 дней премиум-возможностей внутри игры.','Премиум на 30 дней','Премиум'),
  ('season_premium','Премиум-ветка','Премиальная дорожка наград текущего 30-дневного сезона.','Сезонный пропуск','Сезон'),
  ('case_starter','Стартовый кейс','Виртуальный кейс с заранее раскрытыми шансами наград.','1 стартовый кейс',null::text),
  ('case_rare','Редкий кейс','Виртуальный кейс с заранее раскрытыми шансами наград.','1 редкий кейс','Редкий'),
  ('case_legendary','Легендарный кейс','Виртуальный кейс с заранее раскрытыми шансами наград.','1 легендарный кейс','Легендарный'),
  ('energy_refill','Восстановление энергии','Восстанавливает виртуальную энергию до максимума.','Полная энергия',null::text),
  ('creator_boost_24h','Продвижение мемкоина','Выделяет один мемкоин автора на 24 часа.','Продвижение на 24 часа','Автор'),
  ('creator_verified_30d','Проверенный автор','Статус проверенного автора на 30 дней внутри приложения.','Проверка на 30 дней','Проверено'),
  ('creator_analytics_30d','Расширенная аналитика','Расширенная аналитика автора на 30 дней.','Аналитика на 30 дней',null::text),
  ('profile_neon_frame','Неоновая рамка','Постоянная виртуальная рамка профиля.','Постоянный предмет профиля','Ограничено')
) as v(sku,title,description,reward_label,badge)
where public.store_products.sku = v.sku;

update public.profile_items
set title = case item_key
  when 'neon_frame' then 'Неоновая рамка'
  when 'case_pixel_badge' then 'Пиксельный первопроходец'
  when 'case_rare_badge' then 'Редкий сигнал'
  when 'case_legend_badge' then 'Легенда рынка'
  else title end
where item_key in ('neon_frame','case_pixel_badge','case_rare_badge','case_legend_badge');

update public.case_definitions
set title = case sku
  when 'case_starter' then 'Стартовый кейс'
  when 'case_rare' then 'Редкий кейс'
  when 'case_legendary' then 'Легендарный кейс'
  else title end,
  description = case sku
  when 'case_starter' then 'MXM, энергия и обычный коллекционный предмет.'
  when 'case_rare' then 'Увеличенные виртуальные награды и редкие предметы профиля.'
  when 'case_legendary' then 'Крупнейшие виртуальные награды и легендарные предметы.'
  else description end
where sku in ('case_starter','case_rare','case_legendary');

update public.case_loot_definitions
set reward_label = case reward_key
  when 'mxm_100' then '100 MXM'
  when 'energy_25' then '25 энергии (излишек: 5 MXM за единицу)'
  when 'pixel_badge' then 'Значок «Пиксельный первопроходец» (дубликат: 250 MXM)'
  when 'mxm_500' then '500 MXM'
  when 'energy_75' then '75 энергии (излишек: 5 MXM за единицу)'
  when 'rare_badge' then 'Значок «Редкий сигнал» (дубликат: 1 000 MXM)'
  when 'mxm_2500' then '2 500 MXM'
  when 'mxm_2000' then '2 000 MXM'
  when 'energy_150' then '150 энергии (излишек: 5 MXM за единицу)'
  when 'legend_badge' then 'Значок «Легенда рынка» (дубликат: 5 000 MXM)'
  when 'mxm_10000' then '10 000 MXM'
  else reward_label end
where reward_key in ('mxm_100','energy_25','pixel_badge','mxm_500','energy_75','rare_badge','mxm_2500','mxm_2000','energy_150','legend_badge','mxm_10000');

update public.seasons
set title = case
  when season_key = 'market-2-launch' then 'Сезон MEMEX: Начало'
  when title like 'Meme Season%' then replace(title,'Meme Season','Сезон MEMEX')
  else title end
where season_key = 'market-2-launch' or title like 'Meme Season%';

update public.season_rewards
set reward_label = case reward_kind
  when 'mxm_coins' then amount::text || ' MXM'
  when 'energy' then amount::text || ' энергии'
  when 'case' then case metadata->>'sku'
    when 'case_starter' then amount::text || ' стартовый кейс'
    when 'case_rare' then amount::text || ' редкий кейс'
    when 'case_legendary' then amount::text || ' легендарный кейс'
    else reward_label end
  else reward_label end;

update public.missions
set title = v.title,
    description = v.description,
    updated_at = now()
from (values
  ('open_app','Добро пожаловать','Открой MEMEX MARKET из Telegram.'),
  ('sync_gifts','Подключить подарки','Импортируй свои уникальные подарки Telegram.'),
  ('first_coin_trade','Первая сделка','Совершить первую сделку с мемкоином.'),
  ('first_gift_buy','Первый подарок','Купить первый виртуальный подарок Telegram.'),
  ('daily_trades','Три сделки','Совершить 3 сделки с мемкоинами сегодня.'),
  ('daily_offer','Сделать предложение','Предложить цену за подарок другого игрока.'),
  ('daily_listing','Выставить подарок','Выставить один свой подарок на продажу.'),
  ('daily_profit','Закрыть в плюс','Закрыть одну прибыльную позицию по мемкоину.'),
  ('daily_gift_buy','Купить подарок','Купить один подарок сегодня.'),
  ('daily_gift_sell','Продать подарок','Продать один подарок сегодня.'),
  ('weekly_market','Активный трейдер','Совершить 20 сделок с мемкоинами за неделю.'),
  ('weekly_collector','Коллекционер','Купить 4 подарка за неделю.'),
  ('weekly_creator','Запустить мемкоин','Создать один мемкоин за неделю.'),
  ('weekly_flip','Перепродажа','Продать 2 подарка дороже цены приобретения.'),
  ('weekly_offers','Охотник за ценой','Сделать 8 предложений на подарки за неделю.'),
  ('weekly_listings','Активный продавец','Создать 6 листингов подарков за неделю.'),
  ('invite_friend','Пригласить друга','Пригласи нового игрока по своей ссылке.'),
  ('join_main_channel','Подписка на официальный канал','Подпишись на официальный канал @Meme_X_Market и подтверди подписку.')
) as v(key,title,description)
where public.missions.key = v.key;

-- New seasons inherit the localized source reward rows and get a Russian title.
create or replace function public.ensure_current_season_v200()
returns uuid language plpgsql security definer set search_path=public as $$
declare v_current uuid; v_source uuid; v_start timestamptz:=date_trunc('day',now());
begin
  perform pg_advisory_xact_lock(hashtextextended('mxm-current-season-v200',0));
  select id into v_current from public.seasons where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if v_current is not null then return v_current; end if;
  update public.seasons set active=false where active=true and ends_at<=now();
  select id into v_source from public.seasons where season_key='market-2-launch';
  if v_source is null then raise exception 'Исходный сезон не найден'; end if;
  insert into public.seasons(season_key,title,starts_at,ends_at,active)
  values('season-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),'Сезон MEMEX '||to_char(v_start,'YYYY-MM'),v_start,v_start+interval '30 days',true)
  returning id into v_current;
  insert into public.season_rewards(season_id,level,track,required_xp,reward_kind,reward_label,amount,metadata)
  select v_current,level,track,required_xp,reward_kind,reward_label,amount,metadata
  from public.season_rewards where season_id=v_source;
  return v_current;
end;
$$;

revoke execute on function public.ensure_current_season_v200() from public,anon,authenticated;
grant execute on function public.ensure_current_season_v200() to service_role;

commit;
