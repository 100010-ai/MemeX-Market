begin;

update public.missions set title='Добро пожаловать', description='Открой MemeX Market через Telegram.' where key='open_app';
update public.missions set title='Синхронизация коллекции', description='Загрузи свои уникальные подарки Telegram в MXM.' where key='sync_gifts';
update public.missions set title='Первая сделка', description='Соверши первую сделку с мемкоином.' where key='first_coin_trade';
update public.missions set title='Первый подарок', description='Купи первый подарок на рынке MXM.' where key='first_gift_buy';
update public.missions set title='Три сделки', description='Соверши 3 сделки с мемкоинами сегодня.' where key='daily_trades';
update public.missions set title='Сделай оффер', description='Предложи цену за подарок другого игрока.' where key='daily_offer';
update public.missions set title='Выставь подарок', description='Выставь один подарок на продажу.' where key='daily_listing';
update public.missions set title='Закрой в плюс', description='Закрой одну прибыльную позицию по мемкоину.' where key='daily_profit';
update public.missions set title='Постоянный трейдер', description='Соверши 20 сделок с мемкоинами за неделю.' where key='weekly_market';
update public.missions set title='Забег коллекционера', description='Купи 4 подарка за неделю.' where key='weekly_collector';
update public.missions set title='Запусти мем', description='Создай один мемкоин за неделю.' where key='weekly_creator';
update public.missions set title='Флиппер подарков', description='Продай 2 подарка дороже цены покупки.' where key='weekly_flip';
update public.missions set title='Покупка дня', description='Купи один подарок сегодня.' where key='daily_gift_buy';
update public.missions set title='Закрой лот', description='Продай один подарок сегодня.' where key='daily_gift_sell';
update public.missions set title='Охотник за ценой', description='Сделай 8 офферов за неделю.' where key='weekly_offers';
update public.missions set title='Маркет-мейкер', description='Создай 6 лотов с подарками за неделю.' where key='weekly_listings';

commit;
