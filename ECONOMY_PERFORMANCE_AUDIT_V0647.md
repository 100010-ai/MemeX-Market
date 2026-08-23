# Economy & Performance Audit — v0.64.7

Scope: the 16 existing systems requested for the release-quality pass.

| # | Existing system | Result |
|---|---|---|
| 1 | Economy / virtual TON & MXM | DONE — normalized/bounded amounts and non-negative optimistic states |
| 2 | Memecoins | DONE — configured-fee quotes, edge-state guards, clean launch retained |
| 3 | Gift Market | DONE — adaptive paging, concurrency refresh, smaller reads |
| 4 | Gift detail | DONE — safer amounts/unlist semantics and compact market handoff |
| 5 | Portfolio | DONE — 96-item initial paging, Gift/coin search, state preserved |
| 6 | Cases | DONE — rarity pacing and per-series visual treatment without changing server settlement |
| 7 | Battle Pass | DONE — shared profile refresh after claims/prestige and compact XP status |
| 8 | Profile | DONE — cleaner identity hierarchy and large canonical frame renderer |
| 9 | Frames | DONE — constrained/small-device simplification and cheaper effects |
| 10 | Tasks / Achievements / Streak | DONE — throttled live refresh and self-clearing notices |
| 11 | Leaderboard | DONE — tied podium handling and compact list avatars |
| 12 | Notifications | DONE — short-window server dedupe with single source of truth |
| 13 | Store | DONE — shorter content and explicit unavailable purchase state |
| 14 | Creator Tools | DONE — pristine-market analytics no longer look fabricated |
| 15 | /control | DONE — bounded client/server balance mutations and normalized input |
| 16 | Telegram/mobile + API/performance | DONE — constrained-device class, adaptive prefetch, trimmed payloads |

## Regression/safety notes

- Gift purchase conflicts are explicit `409 GIFT_CONFLICT`; the detail UI refreshes authoritative state after a buy/accept conflict.
- Gift listing treats missing price as unlist, while malformed price is rejected; those states are no longer conflated.
- Coin quote/trade/order paths reject non-finite and absurdly large inputs before DB/RPC execution.
- Notification dedupe is intentionally narrow: same kind/title/body/href inside five minutes, not a global suppression of legitimate repeated events.
- Battle Pass/case reward settlement remains server-side and idempotent.
- No mock market data or fallback economy values were introduced.

## Verification

- `node scripts/verify.mjs --static`: PASS.
- TS/TSX parser: 184 files, 0 syntax errors.
- Local import scan: 184 source files, 0 broken local imports.
- CSS brace balance: 983 / 983.
- Release/security invariants: 179 OK, 0 FAIL.
- Supplemental strict semantic smoke on the modified source set with temporary permissive declarations only for unavailable external packages: 0 relevant diagnostics. The temporary declarations are outside the project and are not shipped.
- Full dependency-backed `pnpm run verify` / Next production build still requires installed project dependencies and network/CI access.
