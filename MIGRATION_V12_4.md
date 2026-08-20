# AutoSyndicate v12.4 — исправление дуэлей и API 400

## Что исправляет патч

- устраняет падение экрана дуэлей `ReferenceError: rivalMeta is not defined`;
- расширяет раннюю сетку NPC и показывает до 24 доступных соперников;
- заменяет устаревший rate-limit RPC v10 на `autosyndicate_rate_limit_v12_4`;
- новый limiter совместим с серверными Supabase secret keys и не зависит от самодельной проверки `request.jwt.claim.role`;
- при временной недоступности limiter RPC сервер использует ограниченный аварийный process-local limiter вместо отключения всех API;
- перерабатывает казино, уведомления и русифицирует игровой интерфейс.

## Обновление существующего проекта

1. Задеплойте код v12.4.
2. В Supabase SQL Editor выполните **только** `supabase/schema_v12_4_FIX.sql`.
3. Перезапустите Production deployment в Vercel.
4. Полностью закройте Mini App в Telegram и откройте заново.

`schema_v12_4_FIX.sql` идемпотентен и безопасен для повторного запуска.

## Для новой базы

Используйте `supabase/schema_v12_2_FULL.sql`: в этой сборке патч v12.4 уже встроен в consolidated schema.
