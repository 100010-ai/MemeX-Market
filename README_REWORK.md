# AutoSyndicate — Full Race Rework 3.0

## Что переработано

- Полностью новый ручной drag/race loop: газ, тормоз, ручное переключение передач, тахометр, скорость и мини-карта.
- Тюнинг влияет на скорость набора оборотов и ускорение.
- Старт с выбором: аккуратное сцепление или агрессивная шлифовка.
- Соперник двигается параллельно на мини-карте; победа определяется реальным темпом игрока, а не одной случайной проверкой.
- Радар теперь случайное событие, а не обязательный этап каждого заезда.
- Список соперников перемешивается и учитывает историю последних встреч.
- Новый выбор соперника с анимациями.
- Новый стиль валюты SYND (₳), тяжёлая анимация получения денег.
- Таблица лидеров показывает статистику и открывает публичный профиль.
- Пользователи в чате открывают профиль по нажатию на имя.
- Если права забрали и денег нет, из экрана дуэли доступны «Подработка» и «Банк».
- Тюнинг сохранён совместимым с существующей системой и теперь влияет на гоночную механику.
- Добавлена поддержка реальных изображений автомобилей.

## Как добавить картинку конкретной машины

В `js/data.js` у нужной машины:

```js
{
  id: 1,
  name: "ВАЗ-2106 'Шестёрка'",
  image: null,
  ...
}
```

замени `image: null` на:

```js
image: "assets/cars/1.webp",
```

Файл положи сюда:

```text
assets/
  cars/
    1.webp
```

Для второй машины:

```text
assets/cars/2.webp
```

и в `data.js`:

```js
image: "assets/cars/2.webp",
```

### Подходящий формат

Рекомендуется:
- WebP или JPG;
- 16:9 или примерно 3:2;
- машина хорошо видна сбоку/под углом;
- желательно без огромного пустого пространства вокруг автомобиля.

Если используешь внешнюю ссылку:

```js
image: "https://example.com/my-car.webp",
```

но для Telegram WebApp/хостинга надёжнее хранить изображения локально в `assets/cars/`.

### Где брать изображения

Используй свои изображения, купленные/лицензированные ассеты или изображения с лицензией, разрешающей использование в игре. Не вставляй случайные картинки из Google Images без проверки лицензии.

## Важное про названия реальных машин

Названия автомобилей в проекте уже существуют как игровые данные. Для публичного релиза проверь права на логотипы, фотографии и фирменные визуальные элементы производителей.

## Запуск

Это всё ещё обычный HTML/CSS/JS проект.

Для локального теста лучше использовать простой HTTP-сервер, а не открывать `index.html` через `file://`, особенно если тестируется Supabase.

Например:

```bash
python3 -m http.server 8080
```

и открыть:

```text
http://localhost:8080
```

## Структура

```text
index.html
js/
  state.js
  data.js
  game.js
  race.js
  multiplayer.js
  init.js
assets/
  cars/
README_REWORK.md
```


## Race 4.0 update
- `requestAnimationFrame` race loop; no 50ms interval for physics.
- DOM HUD refresh is throttled while physics stays frame-accurate.
- 6th gear is the hard maximum; no 7th gear.
- 6th gear holds top speed under full throttle.
- AI performance is derived from power ratio + randomized skill rather than a fixed win bias.
- Tachometer and speedometer use only small yellow/green timing bands; transmission upgrades widen the bands.
- Map car positions use `transform`/`will-change` instead of left transitions.
- Launch has small yellow/green windows and imperfect AI launches.


## Rework 4.0 — старт, баланс гонки и реальные игроки

- Стартовый отсчёт `3 2 1` убран: светофор теперь появляется уже поверх гоночного кокпита, когда одновременно видны педали, тахометр и трасса.
- Красный → жёлтый → зелёный длится около 2 секунд; до зелёного физика заезда заблокирована, поэтому игрок успевает понять управление.
- Ускорение и передаточные коэффициенты сделаны заметно плавнее; AI больше не должен выигрывать за счёт недостижимого темпа.
- Добавлена синхронизация реальных профилей игроков в Supabase: уровень, баланс, XP, заезды, победы, поражения, заработок, список машин и активная машина.
- Рейтинг больше не использует ботов: он показывает реальные записи `player_profiles`.
- Публичный профиль показывает **все машины игрока**, а не заглушку «Машина игрока».
- Для таблицы реальных игроков нужно один раз выполнить `supabase/player_profiles.sql` в Supabase SQL Editor.

## v7 race/economy correction
- Race uses a real 1200 m distance; the result cannot appear until the player crosses FINISH.
- Rival crossing FINISH no longer closes the round; player must still drive to the finish.
- Player and rival positions are shown on the same track, with live gap and overtake messages.
- Braking and throttle affect real speed/distance, allowing overtakes in both directions.
- Speed is capped to a realistic 170–380 km/h range; no 777+ km/h display.
- Race payout is exactly the advertised payout; no hidden performance/streak bonuses are added.
- Losses pay 0 SYND from the race itself.
- Tournament attempt is consumed only after entry fee and fuel checks pass.
