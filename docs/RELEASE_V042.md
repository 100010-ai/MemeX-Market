# MXM v0.42

## UI
- Removed the nested panel/pill look from the market and shell.
- Market mode, views and filters now use a flat typographic hierarchy with hairline separators.
- Gift cards are borderless: the collectible artwork is the primary surface.
- Mobile navigation is edge-to-edge rather than a floating rounded panel.
- Desktop sidebar, balance and profile areas were flattened.
- Shared Panel/Stat/SecondaryButton primitives were simplified to reduce dashboard-card styling across the product.

## Filters
- Rebuilt SelectSheet on a `document.body` React portal.
- Filter menus can no longer be clipped by horizontal `overflow` containers.
- Added body scroll lock, Escape close, backdrop close and a full-height mobile drawer / desktop side drawer.
- Active filters remain visible directly in the filter row and can be reset from market metadata.

## Database
No new migration is required after v0.41.
