# Bugfix Audit — v0.64.6

## Telegram WebApp 6.0 warnings
The injected Telegram SDK exposes several methods even when the current client protocol is older. Optional chaining only checks method existence; it does not prove protocol support. Calls are now guarded with `telegramVersionAtLeast`.

- Bot API 6.1+: header/background colors, BackButton, HapticFeedback, openInvoice.
- Modern safe-area and activation event registration is version-gated.

## Control 400
`/api/control/action` previously caught every exception and returned 400, so database/RPC failures looked like malformed client requests. Validation remains 400, conflicts use 409, schema mismatches use 503, unexpected failures use 500.

Client-side guards now block invalid mission/coin/balance/XP/gift/catalog/NPC payloads before POST. Gift price input also normalizes decimal commas and refuses non-finite or non-positive prices.
