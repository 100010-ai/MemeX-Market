# MemeX Market v10 — unified UI and preload pass

## UI
- Removed the boxed/panel treatment from general application sections.
- NFT/Gift cards keep their dedicated card surface.
- Collection groups are flat sections with Gift preview cards only.
- Task UI is now a flat list with separators and inline actions instead of nested cards.
- Bulk Gift listing is an integrated toolbar rather than a standalone panel.
- Bottom navigation, balance and market controls use flatter surfaces.
- Public market liquidity copy no longer appears as a pill/card.

## Initial application preload
- Added a full-screen MemeX launch screen with dark blue/violet visual language.
- Launch screen stays while Telegram auth and critical application data are prepared.
- Critical APIs warmed before reveal: market, collections, feed, orders, portfolio, tasks, leaderboard and runtime config.
- Main navigation route chunks are prefetched before reveal.
- Secondary routes/data are warmed during idle time after reveal to avoid a cold-navigation waterfall.
- Launch screen exits by translating down beyond the viewport.
- Route-level `loading.tsx` is now only a thin progress line rather than a page of skeleton panels.

## Performance behavior
- Existing in-memory API dedupe/cache is reused by the preload, so warmed routes consume cached payloads instead of immediately refetching.
- Critical preload is bounded: reveal waits at least ~780ms for visual continuity and at most ~3.2s for slow services.
- Secondary warming happens after the main application is usable to avoid a large startup request spike.

## Checks available in this environment
- 176 TS/TSX files parsed with the installed global TypeScript parser: 0 syntax-error files.
- 79 API routes; 0 direct `request.json()` handlers.
- 0 emoji codepoints in public app/component TSX.
- Retired advertising source cleanup: clean.
- Release gate product/schema/security checks pass up to dependency-backed TypeScript/ESLint stages.

## Environment limitation
A real `pnpm run build` cannot be executed in this container because `node_modules` is absent and npm registry DNS is unavailable. The release gate therefore cannot launch the project's local TypeScript and ESLint binaries here.
