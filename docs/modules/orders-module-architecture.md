# Orders Module — Architecture & System Design

**Module:** `order-nexus` / `@lasyncro/order-nexus`
**Surface:** FT2 web app — two internal tabs: Intelligence + Fulfillment Queue
**Status:** ✅ Fully working with real data (as of 2026-05-11)

---

## 1. Purpose

The Orders module is the **primary operational command surface** for shop owners. It has two distinct tabs with different purposes:

### Intelligence Tab (`/orders`)

Answers: *What is the state of my orders right now? What needs immediate action?*

- Real-time operational snapshot (not historical analytics)
- SLA breach tracking and aging order prioritisation
- Blocked order review and triage
- Revenue visibility (collected, pending, blocked, leakage)

### Fulfillment Queue Tab (`/fulfillment`)

Answers: *What work needs to be done to ship orders?*

- Pick batch management
- Operator assignment
- WMS execution surface

**Design principle:** The web app is the **owner/manager surface** (review, decide, assign). The mobile app is the **operator surface** (pick, pack, stow, receive). There is no "print pick list" — laSyncro uses mobile-first operator workflows.

---

## 2. Full Data Flow

```
Browser
  │
  ├── Tab 1: Intelligence (/orders)
  │     │
  │     ├── useOrdersFt2Snapshot()
  │     │     └── GET /api/v1/modules/order-nexus/ft2
  │     │           └── orderNexusFt2.state.resolver.ts (withTenant)
  │     │                 ├── extractOrderFulfillmentFacts(shopId, trx)
  │     │                 │     └── trx('order_fulfillment_status') JOIN orders
  │     │                 ├── extractOrderFulfillmentStatusFacts(shopId, trx)
  │     │                 │     └── trx('order_fulfillment_status') JOIN orders
  │     │                 ├── extractRefundsFacts(shopId, trx)
  │     │                 │     └── trx('order_revenue_units_net') JOIN orders
  │     │                 ├── extractFulfilledOrdersCount(shopId, trx)
  │     │                 │     └── trx('orders') JOIN order_fulfillment_status
  │     │                 ├── extractActiveOrdersCount(shopId, trx)
  │     │                 │     └── trx('orders') LEFT JOIN order_fulfillment_status
  │     │                 ├── trx('orders') — freshness (max updated_at)
  │     │                 ├── trx('orders') — total count
  │     │                 ├── trx('orders_operational_control_snapshot') — operational snapshot
  │     │                 ├── trx('daily_operational_brief_snapshot') — decision brief
  │     │                 └── resolveAlignmentPlanes(shopId)
  │     │
  │     ├── useOrdersOperatorSummary()
  │     │     └── GET /api/v1/modules/order-nexus/operator-summary
  │     │           └── OrdersOperatorFacts.service.ts (withTenant)
  │     │                 ├── trx('order_constraints') JOIN orders — constraint counts
  │     │                 ├── trx('orders_operational_control_snapshot') — queue counts
  │     │                 ├── trx('order_age_snapshot') JOIN order_fulfillment_status
  │     │                 │     JOIN order_constraints JOIN orders — aging orders list
  │     │                 └── trx('order_age_snapshot') JOIN ... — imminent SLA breachers
  │     │
  │     └── OrdersFT2Page.tsx
  │           └── mapOrdersFt2Props() — adapter (pure pipe)
  │                 └── OrdersModuleFT2 (module UI component)
  │
  └── Tab 2: Fulfillment Queue (/fulfillment)
        └── FulfillmentQueuePage.tsx
              └── (separate fulfillment hooks)
```

---

## 3. File Map

### Frontend

| File | Role |
|---|---|
| `/SynchroFlow/apps/frontend/src/pages/ft2-pages/OrdersFT2Page.tsx` | Intelligence tab page container — wires hooks, passes props to module |
| `/SynchroFlow/apps/frontend/src/pages/ft2-pages/FulfillmentQueuePage.tsx` | Fulfillment Queue tab page container |
| `/SynchroFlow/apps/frontend/src/pages/orders/useOrdersFt2Snapshot.ts` | React Query hook — fetches `/modules/order-nexus/ft2` |
| `/SynchroFlow/apps/frontend/src/pages/orders/useOrdersFt2Adapter.ts` | Pure adapter — maps snapshot to `OrdersModuleFT2DataProps` |
| `/SynchroFlow/apps/frontend/src/pages/orders/useOrdersOperatorSummary.ts` | React Query hook — fetches `/modules/order-nexus/operator-summary` |
| `/SynchroFlow/apps/frontend/src/layouts/AppLayout/SidenavContent.tsx` | Sidenav — `relatedPaths` ensures `/fulfillment` highlights Orders nav item |

### Module UI

| File | Role |
|---|---|
| `/SynchroFlow/modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx` | **Main module component** — all Intelligence tab UI |
| `/SynchroFlow/modules/order-nexus/src/ui/pages/OrdersModule.tsx` | FT1 fallback orders module |
| `/SynchroFlow/modules/order-nexus/src/ui/components/` | Sub-components |
| `/SynchroFlow/modules/order-nexus/src/contracts/operationalSignals.ts` | Signal type contracts |
| `/SynchroFlow/modules/order-nexus/src/contracts/workQueue.ts` | Work queue type contracts |

### Backend — API Layer

| File | Role |
|---|---|
| `/SynchroFlow/apps/backend/src/api/order-nexus/orderNexus.routes.ts` | Route definitions |
| `/SynchroFlow/apps/backend/src/api/order-nexus/orderNexusFt2.controller.ts` | `GET /api/v1/modules/order-nexus/ft2` |
| `/SynchroFlow/apps/backend/src/api/order-nexus/orders.operator.controller.ts` | `GET /api/v1/modules/order-nexus/operator-summary` |
| `/SynchroFlow/apps/backend/src/api/order-nexus/orderNexusFt2Facts.controller.ts` | Fact endpoints (timeseries, distribution, coverage) |
| `/SynchroFlow/apps/backend/src/api/order-nexus/orderNexusPrioritise.controller.ts` | `POST /api/v1/modules/order-nexus/prioritise` — bulk flag orders |
| `/SynchroFlow/apps/backend/src/api/order-nexus/orderNexusRevenue.controller.ts` | Revenue-specific endpoints |

### Backend — Services

| File | Role |
|---|---|
| `/SynchroFlow/apps/backend/src/services/order-nexus-ft2/orderNexusFt2.state.resolver.ts` | **Main resolver** — wrapped in `withTenant`, threads `trx` to all sub-services |
| `/SynchroFlow/apps/backend/src/services/order-nexus-ft2/orderNexusFt2.types.ts` | TypeScript types for the FT2 snapshot |
| `/SynchroFlow/apps/backend/src/services/order-nexus-ft2/orderNexusFt2.coverage.ts` | Data coverage facts |
| `/SynchroFlow/apps/backend/src/services/order-nexus-ft2/orderNexusFt2.timeseries.ts` | Timeseries data |
| `/SynchroFlow/apps/backend/src/services/order-nexus-ft2/orderNexusFt2.distribution.ts` | Distribution data |
| `/SynchroFlow/apps/backend/src/services/orders-operator/OrdersOperatorFacts.service.ts` | **Operator summary** — wrapped in `withTenant` — aging orders, constraint counts, queue counts |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderFulfillmentFacts.service.ts` | L1: fulfillment signal present/absent — accepts `trx?` |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderFulfillmentStatusFacts.service.ts` | L1: fulfilled/unfulfilled/partial status — accepts `trx?` |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderReturnsFacts.service.ts` | L1: refund revenue + units — accepts `trx?` |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderFulfilledCountFacts.service.ts` | L1: count of fulfilled orders — accepts `trx?` |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderActiveCountFacts.service.ts` | L1: count of active orders — accepts `trx?` |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderTrendFacts.service.ts` | Order trend computation |
| `/SynchroFlow/apps/backend/src/services/order-facts/orderFacts.service.ts` | General order facts |
| `/SynchroFlow/apps/backend/src/services/order-intelligence/orderFulfillmentIntelligence.service.ts` | Pure derivation — no DB calls |
| `/SynchroFlow/apps/backend/src/services/alignment-planes/alignmentPlanes.resolver.ts` | Alignment plane resolution — no bare db() calls |

---

## 4. API Contracts

### `GET /api/v1/modules/order-nexus/ft2`

**No query params** — state-based snapshot, not time-windowed.

**Full response shape:**

```typescript
{
  orders: {
    total: number,
    fulfilled: number,
    unfulfilled: number,
    constrained: number
  },
  revenue: {
    totalSales: number,    // total GMV all time
    earned: number,        // collected from fulfilled orders
    pending: number,       // paid, unfulfilled, no constraint
    blocked: number        // paid, unfulfilled, has constraint
  },
  operationalControl: {
    snapshot_date: string,
    aggregate_version: number,
    realized_revenue: string,
    at_risk_revenue: string,          // ⚠️ always "0.00" — not yet implemented
    total_at_risk_revenue: string,
    sla_breach_24h_revenue: string,   // revenue breaching SLA within 24h
    top_blocking_type: string,        // 'inventory' | 'customer' | 'operational' | 'none'
    blocked_revenue: string,          // revenue from constrained orders ← USE THIS
    revenue_leakage: string,          // lost to refunds
    avg_contribution_margin_pct: string,
    orders_at_sla_risk: number,
    aging_24h: number,
    aging_48h: number,
    aging_72h_plus: number,
    pending_fulfillment: number,
    pending_payment: number,
    exception_orders: number,
    constrained_orders: number,
    revenue_blocked_inventory: string,
    revenue_blocked_customer: string,
    revenue_blocked_operational: string,
    queue_manual_review: number,
    queue_awaiting_inventory: number,
    queue_ready_to_ship: number,
    queue_awaiting_customer: number,
    partial_fulfillment_opportunity: number
  },
  decision: {
    brief: {
      ready_to_ship: number,
      awaiting_customer: number,
      inventory_blocked_revenue: string,
      manual_review: string | number
    } | null   // null when daily_operational_brief_snapshot is empty
  },
  refunds: {
    returnedRevenue: number | null,
    returnedUnits: number | null,
    affectedOrders: number | null
  },
  obligations: {
    totalBlockedValue: number | null,
    coverage: { status: 'sufficient' | 'insufficient' }
  } | null,
  dataCoverage: { completenessPct: number | null } | null,
  visibility: { status: 'sufficient' | 'insufficient' } | null,
  ingestion: { status: 'present' | 'absent' } | null,
  freshness: { status: 'recent' | 'stale' | 'unknown' } | null,
  revenueContinuity: { status: 'isolated' | 'continuous' } | null
}
```

### `GET /api/v1/modules/order-nexus/operator-summary`

**No query params** — state-based.

**Response shape:**

```typescript
{
  constraintCounts: {
    inventory: number,
    customer: number,
    operational: number
  },
  topBlockingType: string | null,
  agingOrders: Array<{
    lasyncro_order_id: string,
    externalOrderId: string | null,
    ageHours: number,
    isShippingSlaBreached: boolean,
    constraintType: string | null,    // 'inventory' | 'customer' | 'operational' | null
    isPriorityFlagged: boolean,
    timeToSlaBreachMinutes: number | null  // negative = already breached
  }>,
  imminentSlaBreachers: Array<{
    lasyncro_order_id: string,
    externalOrderId: string | null,
    minutesUntilBreach: number,
    constraintType: string | null,
    revenue: number
  }>,
  queueCounts: {
    readyToShip: number,
    awaitingInventory: number,
    awaitingCustomer: number,
    manualReview: number
  }
}
```

### `POST /api/v1/modules/order-nexus/prioritise`

**Body:** `{ order_ids: string[] }`
**Purpose:** Bulk flag orders as priority. Used by the bulk select + prioritise flow in the UI.

---

## 5. Database Tables Read

| Table | RLS Type | Used For |
|---|---|---|
| `orders` | Strict ALL | Counts, freshness, total GMV |
| `order_fulfillment_status` | Strict ALL (projection-guarded write) | Fulfillment state per order |
| `order_revenue_units_net` | Strict ALL | Refund facts (view over order_revenue_units) |
| `orders_operational_control_snapshot` | Strict ALL | Operational pulse — queue counts, revenue, aging |
| `order_age_snapshot` | Strict ALL | Per-order aging hours, SLA breach status |
| `order_constraints` | Strict ALL | Active constraint type per order |
| `daily_operational_brief_snapshot` | Strict ALL | Decision brief (⚠️ always empty — worker disabled) |
| `order_risk_snapshot` | Strict ALL | Risk scores per order |
| `order_margin_snapshot` | Strict ALL | Margin per order |

**⚠️ All of these require `SET LOCAL app.current_tenant` before querying as `sf_app` role.**

---

## 6. Key Data Derivations in UI

### Constraint Counts (dominance hierarchy)

```typescript
// Prefer operator summary (accurate DB counts) over snapshot revenue fields
const invBlocked  = operatorSummary?.constraintCounts?.inventory
  ?? operationalControl?.revenue_blocked_inventory ?? 0;
const custBlocked = operatorSummary?.constraintCounts?.customer
  ?? operationalControl?.revenue_blocked_customer ?? 0;
const opsBlocked  = operatorSummary?.constraintCounts?.operational
  ?? operationalControl?.revenue_blocked_operational ?? 0;

const dominantBlocker =
  invBlocked >= custBlocked && invBlocked > 0 ? 'inventory' :
  custBlocked >= invBlocked && custBlocked > 0 ? 'customer' :
  opsBlocked > 0 ? 'operational' : 'unknown';
```

### Queue Counts (prefer operator summary)

```typescript
const qReady  = operatorSummary?.queueCounts?.readyToShip ?? operationalControl?.queue_ready_to_ship ?? 0;
const qCust   = operatorSummary?.queueCounts?.awaitingCustomer ?? operationalControl?.queue_awaiting_customer ?? 0;
const qManual = operatorSummary?.queueCounts?.manualReview ?? operationalControl?.queue_manual_review ?? 0;
```

### Aging Order Bands

```typescript
// Sorted ascending within band (least late first)
const allAgingOrders = (operatorSummary?.agingOrders ?? []).sort((a, b) => a.ageHours - b.ageHours);
const aging24Orders = allAgingOrders.filter(o => o.ageHours >= 24 && o.ageHours < 48);
const aging48Orders = allAgingOrders.filter(o => o.ageHours >= 48 && o.ageHours < 72);
const aging72Orders = allAgingOrders.filter(o => o.ageHours >= 72);
// Each band shows max 3 orders, then "+N more"
```

### Revenue Fields — Semantic Mapping

```typescript
// ✅ CORRECT MAPPINGS
const blockedRevenue = operationalControl?.blocked_revenue;      // constrained orders
const pending        = operationalControl?.pending_revenue;      // unfulfilled, no constraint
const earned         = revenue?.earned;                          // collected from fulfilled
const leakage        = operationalControl?.revenue_leakage;      // lost to refunds

// ❌ DO NOT USE for "blocked" display
// at_risk_revenue — always 0.00, SLA risk scoring not yet implemented
// total_at_risk_revenue — same
```

---

## 7. UI Sections & Layout

The Intelligence tab is a **two-column layout** (desktop) with equal-height columns:

### Left Column — "Start here"

1. **Imminent SLA breachers** — orders breaching within 8h (from `operatorSummary.imminentSlaBreachers`)
2. **Bulk action bar** — appears when orders are checkbox-selected
3. **72h+ band** — max 3 rows + "+N more"
4. **48h+ band** — max 3 rows + "+N more"
5. **24h+ band** — max 3 rows + "+N more"
6. **"Go to fulfillment queue →"** link
7. **Quick actions:**
   - "Ship the N orders that are ready" → `/fulfillment`
   - "Review N blocked orders" → `/fulfillment?filter=blocked`

### Right Column — "Your money" + "Orders by stage"

1. **Your money** (5 rows):
   - Total order value (all-time GMV)
   - Collected — shipped orders (earned)
   - Paid but not yet shipped (pending)
   - Blocked revenue (constrained)
   - Revenue leakage (refunds)
2. **Orders by stage** (5 rows with colour dots + optional action links):
   - Ready to pick & ship → `/fulfillment`
   - Blocked — needs review → `/fulfillment?filter=blocked`
   - Being picked & packed
   - Waiting for stock
   - Waiting for customer reply

### Above Columns

1. **Momentum bar** — "You've shipped N orders and collected $X — keep it up" (shown when fulfilled > 0)
2. **Priority banner** — shown when `constrained > 0` or `exceptions > 0`
3. **72h+ urgent banner** — shown when `aging_72h_plus > 0`
4. **"Right now" pulse row** — 5 stat tiles: Total, Shipped, Ready, Stuck, Waiting

---

## 8. Theming Implementation

The Orders module implements the standard FT2 theming pattern:

```typescript
// File: modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
import { useColorScheme } from '@mui/material/styles';

function useOrdersTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    isDark,
    cardBg:      isDark ? '#1C2740' : '#FFFFFF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    tileBg:      isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
  };
}

// Card containers
const cardSx = {
  background: pal.cardBg,
  border: `1px solid ${pal.border}`,
  borderRadius: 2,
  overflow: 'hidden',
};

// Row dividers
const dividerSx = { borderColor: pal.border };
const rowSx = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  px: 2, py: 1.5,
  borderBottom: '1px solid', borderColor: pal.border,
  '&:last-child': { borderBottom: 'none' },
};
```

**MUI semantic tokens to avoid in dark mode:** `success.dark`, `text.secondary` — use `theme.palette.success.main` and `pal.textSecond` instead.

---

## 9. Sidenav Highlighting

`/fulfillment` is a sub-tab of the Orders module. Without special handling, the sidenav would deselect Orders when on `/fulfillment`.

**Fix location:** `/SynchroFlow/apps/frontend/src/layouts/AppLayout/SidenavContent.tsx`

```typescript
const relatedPaths: Record<string, string[]> = {
  orders: ['/fulfillment'],
};
const isActive = pathname === item.path
  || pathname.startsWith(item.path + '?')
  || (relatedPaths[item.id] ?? []).some(p => pathname === p || pathname.startsWith(p + '?'));
```

To add more sub-routes to Orders, add them to the `orders` array.

---

## 10. Operator Workflow — Correct Mental Model

**Owner (web app):**

1. Sees blocked orders → reviews constraint → resolves (contacts customer / restocks / clears review)
2. Resolved orders enter the **Orders Pool** (ready to be picked)
3. Releases a **pick batch** (sets number of orders) in Fulfillment Queue
4. Batch awaits operator claim

**Operator (mobile app):**

1. Claims the pick batch on mobile
2. Executes pick job via camera scan or MDE + Bluetooth
3. Completes pack job
4. Order ships

**No "Print pick list"** — this is laSyncro's competitive advantage over legacy WMS systems.

---

## 11. Projection Engine — How Snapshot Tables Are Populated

The `orders_operational_control_snapshot` and `order_age_snapshot` tables are written by the **projection engine**, not by this module.

```
Shopify webhook / sync
  → domain_events INSERT
  → auto_create_domain_event_outbox trigger
  → projection.db.worker reads outbox sequentially
  → projection.engine.ts executes handler (e.g. orders.fulfilled.ts)
  → projectOrderRisk() runs
  → order_risk_snapshot, order_age_snapshot, order_margin_snapshot updated
  → reconciliation writes orders_operational_control_snapshot
```

**Key invariant:** Never write to these projection tables outside the projection engine. They are trigger-guarded — `synchroflow.projection = 'true'` must be set.

---

## 12. Known Issues / Gaps

1. **`daily_operational_brief_snapshot` always empty** — `decision.brief` is always null. Snapshot worker disabled pending projection event architecture (Phase 2).

2. **`at_risk_revenue` always 0** — SLA risk revenue scoring not implemented. Do not surface this field. Use `blocked_revenue` for "blocked" display.

3. **`constraintType: null` for aging orders** — Orders that aged past SLA without ever being flagged with an active constraint show `constraintType: null` → "No specific block" in UI. This is correct behaviour — these orders are simply old and unfulfilled, not actively blocked.

4. **Bulk priority CTA is a stub** — "Prioritise selected" calls `/api/v1/modules/order-nexus/prioritise` which flags orders, but the downstream effect (moving them up in the pick queue) is not yet fully implemented.

5. **"Go to fulfillment queue" and filter links** — `/fulfillment?filter=blocked` and `/fulfillment?filter=aging_72h` are passed as `href` but the Fulfillment Queue page does not yet consume the `filter` query param. This is a Phase 2 item.

6. **SLA breach hours are large in dev** — Dev store orders are months old so breach hours are 800-1400h. This is expected in development.

---

## 13. Invariants — Do Not Violate

1. **No date range on Orders** — this is a real-time state surface, not historical analytics. Do not add `FT2DateRangeBar`.

2. **`blocked_revenue` ≠ `at_risk_revenue`** — always use `blocked_revenue` for "blocked" display. `at_risk_revenue` is a different (currently zero) metric.

3. **Operator summary loads independently** — `useOrdersOperatorSummary` loads after the main snapshot. The component must render gracefully when `operatorSummary` is undefined (loading) vs null (no data).

4. **No printing** — do not add print functionality. The mobile app handles physical execution.

5. **Adapter is a pure pipe** — `useOrdersFt2Adapter.ts` must not contain derivation logic, defaults, or inference. It maps field names only.

6. **Sub-services accept optional `trx`** — all order-facts services have signature `(shopId: number, trx?: Knex | Knex.Transaction)`. Always pass `trx` from resolver. Never call sub-services without tenant context.
