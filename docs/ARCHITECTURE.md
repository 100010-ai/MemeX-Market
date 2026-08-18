# Architecture

## Request flow

```text
Telegram client
  -> Next.js client
  -> /api/auth/telegram
  -> HMAC initData validation
  -> sync_telegram_profile RPC
  -> HttpOnly MemeX session

Authenticated UI
  -> Next.js Route Handler
  -> requireProfile()
  -> Supabase server secret client
  -> read query or transactional RPC
  -> JSON response
```

## Why Telegram Gifts are split into two tables

`gift_assets` answers: **what collectible does Telegram describe?**

`virtual_gifts` answers: **who owns the simulated MemeX replica right now?**

A Telegram sync may update metadata in `gift_assets`, but it uses `ignoreDuplicates` when creating the corresponding `virtual_gifts` row. Therefore re-syncing a real Telegram profile does not magically take back a replica that was already sold inside the game.

## Concurrency

Coin buy/sell and gift buy/offer acceptance are Postgres functions. Relevant profile/holding/gift rows are selected `FOR UPDATE` before balances or ownership change. This prevents two concurrent requests from spending the same virtual balance or buying the same listing.

## Market refresh

The first project deliberately uses short polling for shared market reads. It keeps Telegram identity entirely behind the application's HttpOnly session without exposing a separate Supabase client identity model. Push updates can be added later through a dedicated realtime authorization design.
