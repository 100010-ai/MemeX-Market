# MXM v0.45 — настройка AdsGram Rewarded Ads

MXM использует rewarded-рекламу как **добровольный** источник внутреннего виртуального баланса. Награда по умолчанию: 50 виртуальных TON, максимум два подтверждённых просмотра в сутки, cooldown 30 минут.

## 1. AdsGram

В кабинете publisher:
1. Создать рекламную платформу для Telegram Mini App.
2. Создать блок типа **Reward**.
3. После модерации скопировать числовой `Block ID`.
4. Настроить Reward URL для server-side подтверждения.

## 2. Production env

```env
NEXT_PUBLIC_ADSGRAM_BLOCK_ID=12345
ADSGRAM_REWARD_SECRET=<случайный-секрет-минимум-32-символа>
ADSGRAM_ALLOW_CLIENT_FALLBACK=false
```

Надёжный секрет можно получить, например:

```bash
openssl rand -hex 32
```

`ADSGRAM_REWARD_SECRET` нельзя делать `NEXT_PUBLIC_*` и нельзя коммитить в Git.

## 3. Reward URL

В AdsGram укажите:

```text
https://YOUR_DOMAIN/api/rewards/ads/adsgram?userid=[userId]&token=YOUR_SECRET
```

Где `YOUR_SECRET` точно совпадает с `ADSGRAM_REWARD_SECRET` на сервере.

В production MXM **не начисляет награду только по заявлению браузера**. SDK сообщает клиенту, что показ завершён, а баланс изменяется после отдельного Reward URL callback. Это защищает faucet от простого вызова API из модифицированного WebView.

## 4. Supabase

Применить:

```text
supabase/migrations/020_v045_economy_rewarded_ads.sql
```

Если база ещё не получила v0.41, сначала применить `019_v041_remove_games_interface.sql`, затем 020.

## 5. Проверка

- Открыть `/tasks` внутри настоящего Telegram Mini App.
- Убедиться, что кнопка рекламы активна.
- Просмотреть Reward ad до конца.
- Проверить `rewarded_ad_sessions`: статус должен стать `claimed`, `verification_source = adsgram_server`.
- Проверить `economy_events`: появилась строка `rewarded_ad` на +50.
- Проверить баланс пользователя: +50.
- Повторный callback не должен начислить деньги второй раз.
- После двух наград за UTC-сутки третья сессия не должна создаваться.

## 6. Важно

- Debug-показы AdsGram не должны использоваться как production proof of reward.
- Реклама не является обязательной для торговли, Gifts, создания профиля или базового использования MXM.
- В UI явно написано, что TON виртуальные и не являются реальным криптоактивом.
- Если Reward URL не настроен, production-награды намеренно отключены, вместо небезопасного client-only начисления.
