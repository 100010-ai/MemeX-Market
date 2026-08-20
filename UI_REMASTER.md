# Carbon District UI Remaster

The player interface is intentionally separate from operational diagnostics. Database migrations, environment validation, webhook state and internal error codes belong in Vercel/Supabase logs and `/admin`, not in the racing HUD.

## Design system

- graphite/carbon base, restrained amber highlights, off-white typography;
- square/technical geometry with small radii instead of generic oversized mobile cards;
- compact mobile layout designed around Telegram WebView height;
- visual hierarchy based on car, power, opponent threat and action instead of explanatory prose;
- animations use opacity/transform and honor `prefers-reduced-motion`;
- large scrolling collections use containment/content visibility where supported.

## Duel expansion

The client now carries 24 additional Carbon League rivals so a temporary content-bootstrap outage does not collapse the duel catalog. Apply `supabase/schema_ui_remaster.sql` after `schema_v12_2_FULL.sql` to make the same rivals editable from the server/admin catalog.

## Release checks

```bash
npm run check:release
npm run typecheck
npm run build
```

`check:release` verifies commercial-copy markers, the rival pack, CSS structure and Telegram session hardening without requiring a deployment.
