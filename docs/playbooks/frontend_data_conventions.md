# Frontend Data Conventions

## Currency (OV-103)

All monetary display goes through `useCurrency()` from `hooks/useCurrency`.
Never declare a local `formatCurrency`, never hardcode a symbol or locale.

The second parameter is an **options object**, not a currency string:
```ts
format(order.total, { currency: order.currency })   // transaction currency
format(heldRevenue)                                  // display currency
```

Two kinds of money, and getting it wrong is a real bug either way:
- **Transaction** — one order's own figures (line items, subtotal, tax, total).
  Pass `{ currency: order.currency }`. Never convert.
- **Display** — anything summed or compared across orders (KPIs, "at stake",
  aggregates). Pass no currency; inherits the shop's `display_currency`.

Storage layers: `shops.base_currency` (set at OAuth) →
`shop_memberships.display_currency` (per-user preference) → `Intl.NumberFormat`.

## Dates from Postgres DATE columns (OV-122)

A `DATE` column arrives as **local midnight**. `new Date(row.d).toISOString()`
converts to UTC and silently shifts the date back one day for any timezone east
of UTC (Stockholm is UTC+2 in summer). This produced a working-looking resolver
that matched zero rows.

**Compare dates in SQL, not JS.** Let Postgres label the rows:
```ts
.whereRaw(`revenue_date IN (CURRENT_DATE, CURRENT_DATE - INTERVAL '1 day')`)
.select(trx.raw(`(revenue_date = CURRENT_DATE) as is_today`), 'gross_revenue')
```

## "Latest row" is not "today"

`getOverviewPulse` used `ORDER BY revenue_date DESC LIMIT 2` and labelled the
results today/yesterday. On an account with no recent orders this displayed
45-day-old revenue as "Revenue today". A missing row for today means **no sales
today → 0**, not "show me the last number you have".

Applies to any snapshot or daily-aggregate read: filter on the date you intend
to display.

## Persisted state vs transient view state

`IsometricBox` has both `isDimmed` (filter rail, focus overlay — clears when the
user changes filters) and `isInactive` (`warehouse_locations.active` — persisted).
Don't overload one for the other; a user must be able to tell "filtered out"
from "out of service". Inactive entities are also excluded from occupancy/heat
overlays — a decommissioned bin reporting 85% stock is contradictory.