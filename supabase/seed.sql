begin;

insert into public.coins(name,symbol,description,total_supply,token_reserve,quote_reserve,current_price,market_cap,status)
values
  ('Keyboard Cat','KCAT','The cat that only buys green candles.',1000000000,820000000,410,0.0000005,500,'active'),
  ('404 Coin','ERR404','Profit not found. Community definitely found.',1000000000,760000000,760,0.000001,1000,'active'),
  ('Capybara','CAPY','Unbothered through every market cycle.',1000000000,690000000,1380,0.000002,2000,'active'),
  ('Bonk Office','BONKO','Corporate degen department. Meetings optional.',1000000000,640000000,1920,0.000003,3000,'active'),
  ('Frog Terminal','FROG','Terminal-native amphibian liquidity.',1000000000,590000000,2950,0.000005,5000,'active'),
  ('Pixel Rat','PRAT','Lives between blocks and eats abandoned liquidity.',1000000000,540000000,4320,0.000008,8000,'active')
on conflict (symbol) do nothing;

with coin_seed as (
  select id,current_price,symbol,
    case symbol when 'KCAT' then 0.18 when 'ERR404' then -0.08 when 'CAPY' then 0.32 when 'BONKO' then 0.06 when 'FROG' then 0.44 else -0.16 end as trend
  from public.coins where symbol in ('KCAT','ERR404','CAPY','BONKO','FROG','PRAT')
), points as (
  select cs.*,g as n,now()-interval '10 hours'+(g*interval '5 minutes') as ts from coin_seed cs cross join generate_series(0,120) g
), valueset as (
  select *,current_price*(1+trend*((n::numeric/120)-1)+0.035*sin(n::numeric/5)) as close_p,
    current_price*(1+trend*(((greatest(n-1,0))::numeric/120)-1)+0.035*sin(greatest(n-1,0)::numeric/5)) as open_p from points
)
insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
select id,date_trunc('minute',ts),greatest(open_p,0.000000001),greatest(open_p,close_p)*1.012,greatest(least(open_p,close_p)*0.988,0.000000001),greatest(close_p,0.000000001),4+mod(n,11)*2
from valueset on conflict (coin_id,bucket_start) do nothing;

-- Demo market bootstraps the UI before real Telegram users sync their collectibles.
-- Real imports are tagged source='telegram' and use actual Bot API traits/file_ids.
insert into public.gift_assets(source,base_name,gift_number,model_name,model_rarity_per_mille,symbol_name,symbol_rarity_per_mille,backdrop_name,backdrop_rarity_per_mille,backdrop_center_color,backdrop_edge_color,backdrop_symbol_color,backdrop_text_color,demo_emoji,reference_price)
values
 ('demo','Stellar Rocket',87850,'Hyperdrive',30,'Comet',42,'Moss',28,4539974,1718056,6325600,16777215,'🚀',84),
 ('demo','Candy Cane',186640,'Rose Gold',24,'Ribbon',38,'Amethyst',32,8995528,5054000,11480979,16777215,'🍭',96),
 ('demo','Vice Cream',48524,'Vanilla Cat',18,'Sparkle',45,'Ocean',22,2851918,1147955,4895471,16777215,'🍦',121),
 ('demo','Durov''s Glasses',2498,'Night Vision',12,'Bolt',36,'Silver',20,8421504,3158064,10526880,16777215,'🥽',212),
 ('demo','Lunar Snake',102389,'Orange Hood',27,'Moon',31,'Violet',25,6887808,3473476,8998271,16777215,'🐍',105),
 ('demo','Light Sword',6268,'Hyperdrive',30,'Bottle',10,'Neon Blue',10,4145115,2101492,6316287,16777215,'⚔️',184),
 ('demo','Snake Box',17964,'Snow Pair',16,'Ribbon',29,'Forest',18,3246133,1513504,5671995,16777215,'🎁',138),
 ('demo','Heart Locket',781,'Ruby Heart',8,'Crown',15,'Crimson',12,8585216,3473414,13434880,16777215,'💝',310)
on conflict (source,base_name,gift_number) do nothing;

insert into public.virtual_gifts(asset_id,owner_profile_id,source_owner_profile_id,acquired_price,listing_price,last_sale_price,status)
select ga.id,null,null,ga.reference_price,round(ga.reference_price*(1.05 + (ga.gift_number % 9)::numeric/100),2),ga.reference_price,'listed'
from public.gift_assets ga
where ga.source='demo'
on conflict (asset_id) do nothing;

insert into public.gift_collection_candles(base_name,bucket_start,open,high,low,close,volume)
select ga.base_name,date_trunc('hour',now())-(g*interval '1 hour'),
       ga.reference_price*(0.88+g::numeric/260),
       ga.reference_price*(0.91+g::numeric/260),
       ga.reference_price*(0.85+g::numeric/260),
       ga.reference_price*(0.89+g::numeric/260),
       ga.reference_price*(1+(g%3)::numeric/5)
from public.gift_assets ga cross join generate_series(0,24) g
where ga.source='demo'
on conflict (base_name,bucket_start) do nothing;

commit;
