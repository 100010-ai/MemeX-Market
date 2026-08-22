# Memecoin audit — v0.64.4

## Problem reproduced from production screenshots
A coin immediately after creation looked as though the market had already traded it: positive price change, 10 TON volume, one trade and an oversized first candle. The creator's AMM bootstrap was recorded as a normal buy and then reused by public market statistics.

## Fix
The creator bootstrap remains part of the AMM launch economics, holdings and lock accounting, but is classified as launch seeding. Public market history begins at the post-bootstrap opening price. The seed no longer contributes to public trade count, volume, market feed, personal trade history, achievements or creator performance.

## UI redesign
The previous statistics grid occupied most of the first viewport. It was removed from the main flow and moved to an on-demand metrics sheet. The default mobile screen prioritizes price/chart and the buy/sell terminal, while orders, holders and trade activity occupy switchable tabs.

## Invariants retained
- AMM reserves are still authoritative on the server.
- Creator holdings and vesting/lock semantics are retained.
- Fees remain server-side.
- Trade request idempotency and optimistic rollback remain intact.
- Public history is not fabricated when no public trade exists.

## Feed regression caught before packaging
A final source audit found that an automated filter had accidentally been attached to gift/event queries as well as memecoin trades. The invalid filters were removed before packaging; `is_launch_seed=false` is now applied only to `public.trades` queries that actually own that column.
