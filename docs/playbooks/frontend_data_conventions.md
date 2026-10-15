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

**Compare explicit date keys, not JS-parsed DATE objects.** For merchant-day reads, derive the intended shop-local dates first, then make Postgres return a text date:
```ts
.whereIn('revenue_date', [today, yesterday])
.select(trx.raw('revenue_date::text as revenue_date'), 'gross_revenue')
```

OV-DATA-03 added the companion rule for Overview Business Pulse: DB/server
`CURRENT_DATE` is not merchant truth. `getOverviewPulse` resolves today and
yesterday from `shops.timezone` (UTC fallback) before querying
`revenue_projection_daily`.

## "Latest row" is not "today"

`getOverviewPulse` used `ORDER BY revenue_date DESC LIMIT 2` and labelled the
results today/yesterday. On an account with no recent orders this displayed
45-day-old revenue as "Revenue today". A missing row for today means **no sales
today → 0**, not "show me the last number you have".

OV-DATA-03 further tightened that definition: Overview's `Revenue today` is net
revenue from paid orders whose `orders.order_created_at` falls within the
merchant's current local calendar day. Applies to any snapshot or
daily-aggregate read: filter on the date you intend to display.

## Persisted state vs transient view state

`IsometricBox` has both `isDimmed` (filter rail, focus overlay — clears when the
user changes filters) and `isInactive` (`warehouse_locations.active` — persisted).
Don't overload one for the other; a user must be able to tell "filtered out"
from "out of service". Inactive entities are also excluded from occupancy/heat
overlays — a decommissioned bin reporting 85% stock is contradictory.
## React Query client lifetime and tenant isolation (OV-36)

**Never construct a `QueryClient` at module scope.** A module-level client is a
process-lifetime singleton. `AuthenticatedAppShell` returns `null` when logged
out, which unmounts its `QueryClientProvider` — but unmounting a provider does
not destroy the client. The cache survives logout and is re-attached to the
next tenant that logs in.

Build it inside the tenant boundary instead, keyed on `shop_id`:

```tsx
const tenantQueryClient = React.useMemo(() => new QueryClient(), [user?.shop_id]);
```

**GH-1247/GH-1246 — observer isolation:** Creating a replacement QueryClient
is necessary but insufficient. Mounted React Query observers may retain
their original client when only the provider's `client` prop changes.
The authenticated provider subtree must also remount on shop changes:

```tsx
<QueryClientProvider key={user?.shop_id ?? 'unknown'} client={tenantQueryClient}>
  {/* Existing authenticated providers and consumers */}
</QueryClientProvider>
```

This remount includes `IntegrationProvider` and its query observers.
`AuthProvider` remains outside the boundary. A same-shop silent refresh
preserves the client and authenticated subtree.


`shop_id`, not `user.id` — two operators in one shop are the same tenant and
should share a warm cache. `shop_id` is present on all three `AuthContext`
hydration paths (login response, localStorage rehydrate, OAuth handoff decode).

The `eslint react-hooks/exhaustive-deps` warning on that line is a false
positive and is disabled inline: the dependency is the invalidation trigger,
not a value the factory reads. Removing it rebuilds the client every render.

**Many authenticated query keys still omit shop identity.** Examples include
`['floor-planning','layout']`, `['wms','batches']`, `['wms','order-pool']`
and `['alerts', ...]`. The open receive-job query now explicitly includes
the entitlement shop ID.

Client creation and keyed subtree remounting are required together
for authenticated tenant isolation. Two consequences:

- Anything rendering *outside* `AuthenticatedAppShell`'s client is not covered.
  `WmsDisplayPage` is a public route under `main.tsx`'s separate client, scoped
  by `shop_display_tokens` rather than a user session — see OV-37.
- Namespacing every key with `shopId` remains the defence-in-depth end state.
  It is correct by construction rather than by eviction, but touches 30+ hooks
  and every `invalidateQueries` prefix, so it is tracked as its own track.

**How this surfaces if it regresses:** `useFloorPlanning` sets
`placeholderData: (prev) => prev`, so the previous tenant's zones paint
immediately on mount, before any refetch resolves. Overview rendering another
shop's zones after an account switch is the canary.

### Session-bound entitlements (GH-1247)

`EntitlementsProvider` binds committed entitlement state to the valid
positive-integer `shop_id` claim of the authenticated access token.

- Responses must match the requesting shop.
- Late responses from an obsolete session cannot commit.
- Last-good entitlement fallback is allowed only for the same shop.
- Logout, invalid identity and cross-shop transitions cannot expose
  the previous shop's entitlement snapshot or capabilities.
- Unresolved new-shop entitlements remain fail-closed.

The client-side decoded identity provides session binding, not JWT
verification or commercial authority. Backend authentication and
commercial authorization remain authoritative.

### Receive-job authorization and request fencing (GH-1246)

The `useWms` open receive-job tally requires resolved, allowed
`purchasing.core` access (Growth+). This does not introduce a blanket
Growth requirement for all operational WMS receiving.

The query key includes the entitlement shop ID. Cached rows are hidden
when access is denied, and manual refetch repeats the capability gate
because React Query's `refetch()` can bypass `enabled`.

The receive-job Axios configuration carries `_sessionGeneration`,
captured during the originating React render rather than inside the
later request callback.

The existing Axios interceptor rejects obsolete generations before
dispatch or current-token injection. An old Shop A callback must not
dispatch using Shop B's credentials.

Same-shop silent refresh and token replay remain supported.

### Regression boundary

Permanent protection:

- `EntitlementsContext.cross-shop-gh1247.test.tsx`
- `useWms.receive-jobs-entitlement-gh1246.test.tsx`
- `App.authenticated-shop-isolation-gh1247-gh1246.test.tsx`

Local verification: 8/8 full-shell security tests and 78/78
neighboring regressions passed. These are synthetic/JSDOM results,
not deployed-browser, backend JWT or Shopify-provider certification.
