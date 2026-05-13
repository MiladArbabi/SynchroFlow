# Overview Module — Architecture & System Design

**Module:** `overview` / `@lasyncro/overview`
**Surface:** FT2 web app — owner/admin daily operational summary
**Status:** ✅ Fully working with real data (as of 2026-05-11)

---

## 1. Purpose

The Overview module is the **daily landing surface** for shop owners and admins in FT2. It answers three questions at a glance:

1. **What needs my attention right now?** (Morning Brief signals)
2. **How are my operations performing?** (Order/product/customer context)
3. **What's my operational pulse?** (Ship today, blocked orders, blocked revenue, aging SLA)

It is a **read-only aggregation surface** — it never mutates state. All data is pulled from existing projection tables and the alerts system.

---

## 2. Full Data Flow

```
Browser (OverviewFT2Page.tsx)
  │
  ├── useOverviewModulesFt2Snapshot(range)
  │     └── GET /api/v1/modules/overview/modules-ft2?preset=past_30_days
  │           └── overviewModulesFt2.resolver.ts
  │                 ├── getOrderNexusFt2StateSnapshot(shopId)  [orders]
  │                 │     └── orderNexusFt2.state.resolver.ts (withTenant)
  │                 │           ├── extractOrderFulfillmentFacts(shopId, trx)
  │                 │           ├── extractOrderFulfillmentStatusFacts(shopId, trx)
  │                 │           ├── extractRefundsFacts(shopId, trx)
  │                 │           ├── extractFulfilledOrdersCount(shopId, trx)
  │                 │           ├── extractActiveOrdersCount(shopId, trx)
  │                 │           ├── trx('orders') — freshness, total count
  │                 │           ├── trx('orders_operational_control_snapshot')
  │                 │           └── trx('daily_operational_brief_snapshot')
  │                 ├── getProductsFt2Snapshot({shopId, period})  [products]
  │                 │     └── products-ft2.provider.ts
  │                 └── getCustomersFt2Snapshot({shopId, period}) [customers]
  │                       └── customers-ft2.provider.ts
  │
  ├── useOrdersFt2Snapshot()
  │     └── GET /api/v1/modules/order-nexus/ft2
  │           └── orderNexusFt2.state.resolver.ts (same as above)
  │           [Used for: pulse data — ship today, blocked orders, blocked revenue]
  │
  ├── useTrustFt2Snapshot()
  │     └── GET /api/v1/modules/trust/ft2
  │
  └── useMorningBriefSnapshot(forceRefresh)
        └── GET /api/v1/modules/overview/morning-brief
              └── overviewMorningBrief.resolver.ts (withTenant for alerts)
                    ├── db('shops') — timezone (open SELECT, no tenant needed)
                    ├── db('users') + db('shop_memberships') — owner name (open SELECT)
                    └── db.transaction → trx('alerts') — signals (tenant-scoped)
```

---

## 3. File Map

### Frontend

| File | Role |
|---|---|
| `/SynchroFlow/apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx` | Page container — wires all hooks, passes props to module |
| `/SynchroFlow/apps/frontend/src/pages/overview/useOverviewModulesFt2Snapshot.ts` | React Query hook — fetches `/modules/overview/modules-ft2` |
| `/SynchroFlow/apps/frontend/src/pages/overview/useOverviewFt2Adapter.ts` | Pure adapter — maps snapshot to `OverviewModuleFT2DataProps` |
| `/SynchroFlow/apps/frontend/src/pages/overview/useMorningBriefSnapshot.ts` | React Query hook — fetches `/modules/overview/morning-brief` |
| `/SynchroFlow/apps/frontend/src/pages/overview/FirstInsightBanner.tsx` | Banner shown when constrained orders exist — navigates to `/fulfillment` |
| `/SynchroFlow/apps/frontend/src/pages/orders/useOrdersFt2Snapshot.ts` | Hook reused for pulse data (operationalControl) |
| `/SynchroFlow/apps/frontend/src/pages/trust/useTrustFt2Snapshot.ts` | Hook for trust eligibility |

### Module UI

| File | Role |
|---|---|
| `/SynchroFlow/modules/overview/src/ui/pages/OverviewModuleFT2.tsx` | **Reference implementation** — theme pattern, card styling, signal rendering |
| `/SynchroFlow/modules/overview/src/ui/` | All overview UI components |

### Backend — API Layer

| File | Role |
|---|---|
| `/SynchroFlow/apps/backend/src/api/overview/overview.ft2.routes.ts` | Route definitions for overview endpoints |
| `/SynchroFlow/apps/backend/src/api/overview/overview.modules-ft2.controller.ts` | `GET /api/v1/modules/overview/modules-ft2` |
| `/SynchroFlow/apps/backend/src/api/overview/overview.morning-brief.controller.ts` | `GET /api/v1/modules/overview/morning-brief` — cache-first from `morning_brief_snapshots` |
| `/SynchroFlow/apps/backend/src/api/overview/overview.ft2.controller.ts` | `GET /api/v1/modules/overview/ft2` (legacy — less used) |

### Backend — Services

| File | Role |
|---|---|
| `/SynchroFlow/apps/backend/src/services/overview-modules-ft2/overviewModulesFt2.resolver.ts` | Entry point — aggregates orders + products + customers snapshots |
| `/SynchroFlow/apps/backend/src/services/overview-ft2/overviewMorningBrief.resolver.ts` | Morning brief — reads alerts, generates greeting + signals |
| `/SynchroFlow/apps/backend/src/services/overview-ft2/overviewFt2.resolver.ts` | Legacy overview resolver |
| `/SynchroFlow/apps/backend/src/services/order-nexus-ft2/orderNexusFt2.state.resolver.ts` | Orders state — operational control snapshot, counts, revenue |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderFulfillmentFacts.service.ts` | L1 fact: fulfillment signal present/absent |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderFulfillmentStatusFacts.service.ts` | L1 fact: fulfilled/unfulfilled/partial status |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderReturnsFacts.service.ts` | L1 fact: refund revenue + units |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderFulfilledCountFacts.service.ts` | L1 fact: count of fulfilled orders |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderActiveCountFacts.service.ts` | L1 fact: count of active (unfulfilled) orders |
| `/SynchroFlow/apps/backend/src/services/products-ft2.provider.ts` | Products FT2 snapshot entry point |
| `/SynchroFlow/apps/backend/src/services/customers-ft2.provider.ts` | Customers FT2 snapshot entry point |

---

## 4. API Contracts

### `GET /api/v1/modules/overview/modules-ft2`

**Query params:** `preset` (past_30_days | past_7_days | past_90_days) or `from`/`to`

**Response shape:**

```typescript
{
  orders: {
    orders: { total, fulfilled, unfulfilled, constrained },
    revenue: { totalSales, earned, pending, blocked },
    operationalControl: {
      queue_ready_to_ship, constrained_orders, blocked_revenue,
      revenue_blocked_inventory, revenue_blocked_customer, revenue_blocked_operational,
      aging_24h, aging_48h, aging_72h_plus, pending_fulfillment,
      at_risk_revenue, sla_breach_24h_revenue, revenue_leakage, ...
    },
    decision: { brief: { ready_to_ship, awaiting_customer, inventory_blocked_revenue, manual_review } | null },
    meta: { degraded: boolean }
  },
  products: { context, outcome, trend, signals, dataFreshness, operationalCounts, supplyCounts, ... },
  customers: { context, outcome, trend }
}
```

**RLS fix applied:** `orderNexusFt2.state.resolver.ts` wrapped in `withTenant`, all sub-services accept optional `trx`.

### `GET /api/v1/modules/overview/morning-brief`

**Response shape:**

```typescript
{
  signals: Array<{
    id: string,           // alert_key
    alertType: string,    // maps to DEEP_LINK_MAP
    priority: 1-5,
    title: string,
    detail: string,
    module: string,       // destination module
    deepLink: string,     // e.g. '/orders?filter=aging_72h'
    revenueImpact: number
  }>,
  hasUrgentIssues: boolean,
  generatedAt: string,
  trustWarning: boolean,
  greeting: string,       // "Good morning/afternoon/evening, {firstName}"
  summaryLine: string,    // "All clear..." or "N issues need attention"
  fromCache: boolean
}
```

**RLS fix applied:** `alerts` query wrapped in `db.transaction` with `SET LOCAL app.current_tenant`.

**Cache behaviour:** Reads from `morning_brief_snapshots` table if fresh (same day). Force-refreshes when `forceRefresh` prop toggled.

**Dev bypass:** Trust gate skipped in `NODE_ENV=development`. Remove before production.

---

## 5. Database Tables Read

| Table | RLS Type | Used For |
|---|---|---|
| `orders_operational_control_snapshot` | Strict ALL | Pulse data — ship today, blocked, aging |
| `order_fulfillment_status` | Strict ALL | Fulfillment facts |
| `orders` | Strict ALL | Order counts, freshness |
| `daily_operational_brief_snapshot` | Strict ALL | Decision brief (currently empty — snapshot worker disabled) |
| `alerts` | Strict ALL | Morning brief signals |
| `morning_brief_snapshots` | Strict ALL | Cached morning brief |
| `shops` | Split (open SELECT) | Timezone for greeting |
| `users` | Split (open SELECT) | Owner first name |
| `shop_memberships` | Split (open SELECT) | Owner lookup |

**⚠️ Known gap:** `daily_operational_brief_snapshot` is always empty — the snapshot worker is intentionally disabled pending projection event architecture. The decision brief in `operationalControl.decision.brief` will be null.

---

## 6. Frontend Props Contract

`OverviewModuleFT2` receives `OverviewModuleFT2DataProps`:

```typescript
{
  trust: { trustEligible, dataFreshness, syncCoverage, crossSourceConsistency } | null,
  context: { ordersObserved, productsObserved, customersObserved },
  snapshot: { orders: { revenueTotal, currency } | null, products: null, customers: null },
  pulse: {
    shipToday: number | null,       // queue_ready_to_ship
    blockedOrders: number | null,   // constrained_orders
    blockedRevenue: number | null,  // blocked_revenue (NOT at_risk_revenue)
    aging24h: number | null,
    aging48h: number | null,
    aging72hPlus: number | null,
  } | null,
  morningBrief: MorningBriefSnapshot | null,  // owner/admin only
  currency: string,                            // ISO code e.g. 'USD'
  alignment: null,
  onNavigate: (deepLink: string) => void,
  onRefreshBrief: () => void,
}
```

**Critical mapping note:** `pulse.blockedRevenue` maps to `operationalControl.blocked_revenue` — NOT `at_risk_revenue`. These are semantically different:

- `blocked_revenue` = revenue from orders with active constraints (cannot ship)
- `at_risk_revenue` = revenue from orders at SLA risk (currently always 0 — scoring not yet implemented)

---

## 7. Theming Pattern (Reference Implementation)

The Overview module is the **canonical reference** for all FT2 module theming:

```typescript
function useOverviewTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    isDark,
    cardBg:      isDark ? '#1C2740' : '#FFFFFF',
    pageBg:      isDark ? '#151D29' : '#F8F9FA',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    divider:     isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    tileBg:      isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    footerBg:    isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
    shadow:      isDark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.06)',
  };
}
```

All modules must implement the same pattern — see Orders module for the adapted version (`useOrdersTheme`).

---

## 8. Morning Brief Deep Link Map

The morning brief maps `alert_type` → frontend route:

| Alert Type | Module | Deep Link |
|---|---|---|
| `sla_breach` | order-nexus | `/orders?filter=sla_breached` |
| `operational` | order-nexus | `/orders?filter=aging_72h` |
| `inventory` | order-nexus | `/orders?filter=out_of_stock` |
| `customer` | order-nexus | `/orders?filter=address_issue` |
| `revenue_at_risk` | cashflow | `/cash-flow?focus=constrained` |
| `missing_cogs` | finances | `/finances?focus=missing_cogs` |
| `stockout_risk` | demand | `/demand?filter=critical` |
| `reorder_warning` | demand | `/demand?filter=warning` |
| `high_return_rate` | returns | `/returns` |
| `supplier_delay` | suppliers-portal | `/suppliers-portal` |

---

## 9. Known Issues / Gaps

1. **`daily_operational_brief_snapshot` always empty** — snapshot worker disabled. `decision.brief` will always be null. This means the "decision brief" section in the UI shows degraded state. Fix requires implementing projection event for snapshot recompute (Phase 2).

2. **Morning brief trust gate bypassed in dev** — `NODE_ENV=development` skips trust check. Must be removed before production deployment. File: `overviewMorningBrief.resolver.ts` line ~146.

3. **Products and customers context null** — `products.operationalCounts`, `supply`, `dependency` fields may be null if their sub-services have unfixed RLS issues. Apply the same `withTenant` fix to products and customers providers.

4. **`at_risk_revenue` always 0** — SLA risk revenue scoring not yet implemented in the projection engine. Do not surface this field in UI until it produces real values.

---

## 10. Invariants — Do Not Violate

1. **Never mutate state from the overview module** — read-only surface
2. **Never compute or infer in the adapter** — `useOverviewFt2Adapter.ts` is a pure pipe
3. **Morning brief signals come from `alerts` table only** — never query raw order/product tables in the brief resolver
4. **`pulse.blockedRevenue` = `blocked_revenue`** — never map `at_risk_revenue` here
5. **Morning brief owner check** — only show `morningBrief` prop when `user.role === 'owner' || 'admin'`
6. **Date range applies to products + customers context only** — orders snapshot is stateless/date-agnostic
