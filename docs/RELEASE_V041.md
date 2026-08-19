# MXM v0.41

## Product changes

- Removed the game system from the public product surface.
- `/games` now redirects to `/market` so cached Telegram links do not land on a 404.
- Removed `/api/games` and `/api/games/play`.
- Disabled the `daily_game_3` mission through migration 019 while preserving historical game data.
- Redesigned the mobile bottom navigation around five core destinations.
- Refined the app header, desktop sidebar, market switcher, search, filter chips, Gift cards, feed and selection sheets.

## Deploy

1. Deploy the application.
2. Apply `supabase/migrations/019_v041_remove_games_interface.sql`.
3. Run `npm run release:check`.
