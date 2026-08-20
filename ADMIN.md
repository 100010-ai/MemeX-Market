# AutoSyndicate Control Center v11

Route: `/admin`

## Authorization

The panel requires a verified Telegram session and numeric Telegram ID from `ADMIN_TELEGRAM_IDS`. Merely knowing `/admin` is not sufficient.

## Overview

The overview aggregates:

- total players;
- banned players;
- total races;
- races during the last 24 hours;
- active market listings;
- case rolls;
- clans;
- active duel rooms;
- Telegram updates in the last 24 hours;
- total player balance;
- total earned currency;
- global win rate;
- duel states during the last 24 hours;
- top players by balance;
- top players by rating;
- recent races;
- recent admin audit events.

## Players

Search by player ID, display name or Telegram username.

Actions:

- set balance;
- add/subtract balance;
- ban with reason;
- unban;
- grant an active car.

Server-side RPC clamps privileged numeric values. Bans are checked by server routes, not only hidden in UI.

## Cars

Create/update server catalog records including:

- ID;
- name;
- image path;
- price;
- power;
- tier;
- category;
- flavor text;
- active flag;
- sort order.

The game bootstrap loads active records from Supabase, so new active entries can appear without editing the legacy hardcoded catalog.

## Opponents

Create/update:

- stable key;
- display name;
- power/reward/unlock level;
- car name/rating;
- driving style;
- favourite tracks;
- history wins/losses;
- avatar initials;
- taunt/pre-race lines;
- win/loss reaction;
- boss/active flags;
- sort order.

v11 seeds 40 opponents in total.

## Telegram commands

Create/update/delete custom commands. `/start` cannot be deleted. `/admin` remains protected application logic.

## Settings

`game_settings_v11` is a JSONB feature/balance registry. Examples:

```text
race.reward_multiplier
race.duel_enabled
bot.duel_words
market.enabled
```

This is intentionally server-controlled so balancing and feature flags do not require rebuilding the frontend.

## Audit

Privileged mutations are recorded in `admin_audit_log_v11` with admin player ID, Telegram ID, action, target, payload and timestamp.
