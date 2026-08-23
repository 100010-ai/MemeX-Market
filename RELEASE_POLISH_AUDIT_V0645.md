# Release Polish Audit — v0.64.5

Scope: the 14 existing-system quality items requested for the release pass. The pass intentionally favors compact visual hierarchy and existing mechanics over new feature sprawl.

| # | Area | Result |
|---|---|---|
| 1 | Home / dashboard | DONE — actionable compact overview, root redirect, market/tasks/portfolio/activity/leaderboard signals |
| 2 | Gift detail | DONE — primary metric hierarchy, secondary metrics disclosure, explicit purchase confirmation |
| 3 | Gift market | DONE — explicit deep links, state/scroll restoration, abortable debounced remote search |
| 4 | Portfolio | DONE — persistent tabs and gift/coin sorting, compact Market/Orders handoff, existing realtime/listed semantics retained |
| 5 | Cases | DONE — rarity-aware reveal/haptics and result presentation; authoritative server reward, pity/history/skip/open-again retained |
| 6 | Battle Pass | DONE — stronger current/milestone visual hierarchy on existing compact Free/Premium track |
| 7 | Profile / frames | DONE — shared equipped-frame renderer in shell, small-size ornament cleanup, continuous frame silhouettes retained |
| 8 | Memecoins | DONE — high-impact double-confirm plus v0.64.4 zero-trade/tiny-price/one-screen terminal behavior retained |
| 9 | Tasks / achievements / streak | DONE — server-batched Claim All and foreground refresh of progression state |
| 10 | Notifications | DONE — near-duplicate suppression, existing unread/preferences/rollback behavior retained |
| 11 | Telegram Android/iOS UX | DONE — keyboard/viewport class, fixed-nav avoidance, safe-area behavior retained |
| 12 | Performance | DONE — constrained-device prefetch budget, compact Home coin endpoint, abortable search, off-screen row containment |
| 13 | Build hardening | DONE — `verify` and `verify:static`, updated release docs, static gates integrated into release-check |
| 14 | `/control` | DONE — before/after mutation audit snapshots, tab counts/search context, prior confirm/double-submit protections retained |

## Verification model

The project source archive does not include `node_modules`, and the execution environment cannot fetch packages from `registry.npmjs.org`. Therefore this artifact does **not** claim a successful dependency-backed `pnpm run build` in this container.

The packaged source is checked with the offline gate (`node scripts/verify.mjs --static`), which validates TS/TSX parsing, local imports, CSS structural balance and product/security invariants. A supplemental strict semantic smoke check with temporary ambient declarations is used only to inspect the files modified in v0.64.5; those declarations are not added to the project.

Production approval remains: install the locked dependencies, run `pnpm run verify`, then smoke-test the deployed build inside Telegram WebView.
