# MemeX Market — MRKT / Player-only bugfix pass v6

This pass hardens the MRKT-style market and irreversible NPC-to-player handoff.

Key fixes:
- player-only collection floor/listed/item/holder metrics no longer count system-owned inventory;
- public genesis state cannot advertise remaining NPC liquidity after irreversible handoff;
- explicit callback/data typing added in high-risk auth/admin/gift-sync paths;
- migration 9995 added and required by release gate;
- API guard/direct JSON/schema/RPC static checks rerun.

Validation available in the audit environment:
- 170 TS/TSX files parsed with 0 syntax errors;
- 77 API route files, 0 unguarded HTTP handler exports;
- 0 direct request.json() uses;
- 78 runtime RPC names, 0 missing migration definitions;
- 52 runtime DB relations/views, 0 missing migration definitions;
- no retired AdsGram/rewarded runtime imports;
- no probable literal production secrets found.

Full `pnpm run build` was not executable in the audit container because node_modules is absent and registry.npmjs.org DNS is unavailable. Run `pnpm install --frozen-lockfile && pnpm run release:check && pnpm run build` in CI/Vercel.
