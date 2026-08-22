# MemeX Market — Performance & Smoothness Audit v9

## Цель

Финальный production-pass для Telegram Mini App: уменьшить стартовый JS, количество фоновых запросов и Realtime-событий, снизить нагрузку на WebView и не заставлять интерфейс перерисовываться из-за чужой активности на рынке.

## Что изменено

### Старт приложения
- Supabase browser client загружается динамически только перед запуском Realtime, а не попадает в критический стартовый JS.
- Command Palette и dev performance overlay вынесены в отложенные чанки; на мобильных устройствах Command Palette вообще не загружается.
- Production performance overlay недоступен.
- Убран лишний preconnect к Fragment: внешние Gift media идут через серверные proxy/resolver пути.

### Realtime
- Realtime запускается после первого рендера/idle, а не конкурирует с первичной загрузкой страницы.
- При уходе Telegram/WebView в background каналы отключаются; после возврата выполняется один reconcile refresh.
- Добавлен debounce и idle scheduling обновлений.
- Vault подписывается только на holdings/trades/Gifts текущего профиля.
- Coin detail подписывается только на выбранный coin.
- Gift detail подписывается только на выбранный Gift.
- Orders больше не слушает весь глобальный поток trades/market events: собственные Gifts фильтруются по owner, а offer changes слушаются отдельно.

### API и Supabase
- Клиентский GET cache имеет ограниченный LRU-размер и dedupe одинаковых параллельных запросов.
- Runtime config получает короткий server-process cache с in-flight dedupe.
- Gift market filter dictionary кешируется на сервере 60 секунд.
- Collection overview кешируется коротко и загружает только ограниченный набор строк.
- Admin update принудительно инвалидирует runtime-config cache.

### Тяжёлые компоненты
- Графики загружаются через dynamic import.
- Advanced offers и conditional orders вынесены из критического bundle.
- Lottie подключается только когда реально требуется анимированный Gift.
- TGS JSON имеет ограниченный LRU cache.
- Lottie на coarse-pointer устройствах работает в low quality.

### Gift media
- Изображения используют lazy loading / viewport activation.
- Анимации паузятся во время scroll/touchmove и когда приложение скрыто.
- Общие IntersectionObserver переиспользуются вместо observer на каждую карточку.
- Убрано принудительное compositor layer для каждой обычной Gift-карточки; GPU-layer оставлен только canvas/video.
- Удалён постоянный `will-change` с Gift cards.

### Рендер длинных списков
- Collection cards, task cards и feed rows используют `content-visibility: auto` и intrinsic size.
- Offscreen элементы не требуют полноценного layout/paint до приближения к viewport.
- Для touch UI добавлен `touch-action: manipulation` и отключён WebKit tap highlight.
- `prefers-reduced-motion` поддерживается.

### Cleanup
- Удалён неиспользуемый `components/games` runtime-код.
- Старый AdsGram/rewarded runtime по-прежнему отсутствует и дополнительно удаляется prebuild cleanup.

## Проверки

- Release-gate: все статические product/security/schema проверки проходят.
- API: все route handlers защищены общей JSON error boundary; прямых `request.json()` нет.
- DB contracts: используемые relations/views и RPC имеют определения в migration set.
- TS/TSX syntax pass выполняется отдельно глобальным TypeScript parser.
- Секреты и runtime artifacts исключаются из финального ZIP.

## Ограничение среды проверки

Полный `pnpm run build` в этой рабочей среде невозможно запустить честно: `node_modules` отсутствует, а Corepack/pnpm не может скачать зависимости из `registry.npmjs.org` из-за сетевого/DNS ограничения (`EAI_AGAIN`). Поэтому финальный CI/Vercel build всё равно должен выполнить `pnpm install --frozen-lockfile && pnpm run build` в среде с registry-доступом.
