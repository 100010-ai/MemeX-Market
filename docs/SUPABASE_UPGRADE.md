# Supabase upgrade

Apply every SQL file in `supabase/migrations` in numeric order. The current schema ends at:

```text
027_*.sql
028_remove_advertising.sql
029_market_scalability.sql
```

Migration 027 installs Market 2.0 monetization, creator, season, case, collection, profile, watchlist and Stars-reservation contracts. Migration 028 removes retired advertising/sponsored-task objects and installs bounded admin/refund-reconciliation aggregates. Migration 029 adds indexed stable-random Gift paging plus catalogue-wide server filtering and sorting. Deploy the application only after all three are present.
