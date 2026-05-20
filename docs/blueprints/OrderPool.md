# Order Pool — Blueprint & System Contract

**Last updated: May 2026**
**Status: Backend partial — Frontend not yet built**
**Depends on:** constraint_system_blueprint.md, WMS_process_blueprint.md, WarehouseGrid.md

---

## Overview

The Order Pool is the **holding layer between constraint resolution and batch release**.

Every order that arrives in LaSyncro passes through two gates before it can be fulfilled:

``````typescript
Order arrives (Shopify sync)
        ↓
[GATE 1 — CONSTRAINT FILTER]
Constraint engine evaluates inventory / customer / operational blocks.
Blocked orders → Blocked Queue (owner resolves).
        ↓ no active constraints
[GATE 2 — ORDER POOL]
Order waits here until owner releases it into a pick batch.
Owner can prioritize, inspect, and select orders before release.
        ↓ owner releases batch
[PICK BATCH]
Operator claims on mobile → Pick → Pack → Ship.
```

The pool is not a database table. It is a **derived view** — orders that satisfy:
- `order_fulfillment_status.status IN ('pending', 'processing')`
- No active row in `order_constraints` with `is_active = true`
- No row in `pick_batch_orders` (not already batched)

---

## Core Principles

### 1. Pool membership is derived, never written
No `in_pool` flag. No `pool_at` timestamp. Pool state is always computed from the three conditions above. This ensures single source of truth and prevents drift.

### 2. Priority is explicit, not implicit
Priority is set by the owner via `is_priority_flagged` on `order_fulfillment_status`. Priority-flagged orders surface first in the pool UI and are selected first during batch release (before greedy fill). The flag is set via `set_order_priority_flag()` Postgres function and cleared automatically when the order enters a batch (`clear_priority_flag_on_batch()`).

### 3. Batch release respects line-item ceiling, not order count
Ceiling is `shop_wms_settings.max_batch_line_items` (default 108). Full orders only — no order is ever split across batches. A single order exceeding the ceiling is included anyway to prevent starvation.

### 4. Pick route is spatially optimized
Line items within a batch are sorted by physical warehouse coordinates (`position_x ASC, position_y ASC`) from `warehouse_locations`, not alphabetically by `location_code`. This minimizes operator walk distance. Falls back to `location_code ASC` when coordinates are null.

### 5. Affinity-based slotting feeds route efficiency
`locationSuggestion.service.ts` uses 90-day co-occurrence data to suggest stow locations for inbound products. Products ordered together are stored together → shorter pick routes → higher UPH.

---

## Data Model

No new tables required. Pool is derived from existing tables:

```typescript
| Table | Role |
|---|---|
| `orders` | Source of truth for order identity and `order_created_at` |
| `order_fulfillment_status` | `status`, `is_priority_flagged`, `priority_flagged_at`, `customer_block_type` |
| `order_constraints` | Active constraint check — pool excludes orders with `is_active = true` |
| `pick_batch_orders` | Batch membership check — pool excludes already-batched orders |
| `order_line_items` | Line item count, unit count, variant identity |
| `inventory_truth` | Location of each variant → zone distribution for pre-release preview |
| `warehouse_locations` | `position_x`, `position_y` → spatial pick route sort |
| `shop_wms_settings` | `max_batch_line_items` — batch size ceiling |
```

---

## API Endpoints

```typescript
| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/api/v1/wms/order-pool` | ⚠️ Partial | Returns pool orders — missing `external_order_id`, customer name, `is_priority_flagged`, zone distribution |
| POST | `/api/v1/wms/batch/release` | ⚠️ Partial | Creates batch — missing `priorityOrderIds[]` param and spatial route sort |
| POST | `/api/v1/wms/orders/:orderId/priority` | ❌ Missing | Thin wrapper on `set_order_priority_flag()` |

### Target `GET /api/v1/wms/order-pool` response shape

{
  eligible_order_count: number;
  max_batch_line_items: number;        // from shop_wms_settings — feeds ceiling UI
  orders: Array<{
    lasyncro_order_id: string;
    external_order_id: string | null;  // MISSING — must add
    customer_name: string | null;       // MISSING — must add
    total_price: number;
    currency: string;
    order_created_at: string;
    is_priority_flagged: boolean;       // MISSING — must add
    line_item_count: number;            // MISSING — must add
    unit_count: number;                 // MISSING — must add
    zone_distribution: string[];        // MISSING — zones items live in e.g. ['A','B']
  }>;
}
```

### Target `POST /api/v1/wms/batch/release` request shape

```typescript
{
  assigned_operator_id?: number;
  assigned_packer_id?: number;
  priority_order_ids?: string[];  // MISSING — locked in first, then greedy fill
}
```

### Target `POST /api/v1/wms/batch/release` response shape

```typescript
{
  pick_batch_id: string;
  order_count: number;
  total_line_items: number;
  total_units: number;
  zone_distribution: string[];          // MISSING — zones batch spans
  estimated_pick_minutes: number | null; // MISSING — derived from analytics avg
  operator_hint: string | null;          // MISSING — e.g. "Assign someone familiar with Zone C"
}
```

---

## Batch Release — Selection Algorithm

1. Lock priority_order_ids (if provided) — validate all are in pool
2. Add priority-flagged orders from pool (is_priority_flagged = true, not already in selection)
3. Greedy fill: oldest-first (order_created_at ASC) until max_batch_line_items ceiling
4. Starvation guard: if first order alone exceeds ceiling, include it anyway
5. Create pick_batch record
6. Insert pick_batch_orders for selected orders
7. Write reservation_hold inventory movements for all line items
8. Clear priority flags: clear_priority_flag_on_batch(selectedOrderIds)
9. Fire batch released alert → push notification to assigned operator
10. Return enriched response with zone distribution + estimated pick time

---

## Pick Route Optimization

### Current state (alphabetical — suboptimal)

```sql
ORDER BY it.location_code ASC
```

### Target state (spatial — optimal)

```sql
LEFT JOIN warehouse_locations wl ON wl.location_code = it.location_code
  AND wl.shop_id = {shopId}
ORDER BY
  COALESCE(wl.position_x, 9999) ASC,
  COALESCE(wl.position_y, 9999) ASC,
  it.location_code ASC  -- tiebreaker
```

This sorts line items by physical warehouse position so the operator walks the shortest path. Items without coordinates fall to the end (COALESCE to 9999).

### Why this matters for SMB scale

- 12 bins × 3 levels = 36 pick locations
- Alphabetical sort: operator may zigzag A→C→B→A
- Spatial sort: operator walks A→B→C in one pass
- At 100 picks/day: spatial sort saves ~15-20 min/operator/day
- At 5 operators: 75-100 min/day recovered = ~1 extra operator-hour daily

---

## Owner Command Surface (Frontend — Not Yet Built)

### Tab bar target

```tsx
Overview → Blocked → Release Queue → Fulfillment → Outbound → Inbound → Returns
```

### Release Queue page (`/orders/pool`)

- Lists all pool orders with: external ID, customer, value, age, line items, units, zones, priority flag
- Priority toggle per order → calls `POST /wms/orders/:orderId/priority`
- Multi-select with running line item counter vs ceiling
- Pre-release preview dialog: zone distribution, estimated pick time, operator assignment
- Release → `POST /wms/batch/release` → success → navigate to Fulfillment tab

### Blocked Orders page (`/orders/blocked`)

- Groups orders by constraint type: inventory / customer / operational
- Per-type resolution actions:
  - **Inventory** → link to product stock + partial fulfill option
  - **Customer** → contact log + mark resolved
  - **Operational** → SLA override + escalation + priority flag
- On resolution → constraint cleared → order moves to pool automatically

---

## Integration Points

### → constraint_system_blueprint.md

Pool membership depends entirely on `order_constraints.is_active`. Pool is the downstream consumer of constraint resolution. When all active constraints for an order are resolved (`is_active = false`), the order automatically appears in the pool on next fetch. No explicit "move to pool" action exists.

### → WMS_process_blueprint.md

Pool feeds the pick batch lifecycle defined in WMS blueprint. `releaseBatch()` in `pickBatch.service.ts` is the transition point. After release, order ownership transfers from pool to WMS batch lifecycle.

### → WarehouseGrid.md

Pick route optimization uses `position_x` / `position_y` from `warehouse_locations` (migration 0108). Zone distribution in pool and pre-release preview uses `zone_type` from the same table. `locationSuggestion.service.ts` (affinity-based slotting) feeds long-term route efficiency by co-locating frequently co-ordered products.

---

## Implementation Checklist

### Backend

- [ ] A1 — Enrich `httpGetOrderPool` with missing fields
- [ ] A2 — Add `priorityOrderIds[]` to `releaseBatch` service + priority-first selection
- [ ] A3 — Add `POST /wms/orders/:orderId/priority` endpoint
- [ ] A4 — Upgrade pick route sort to spatial coordinates in `httpGetBatchLineItems`

### Frontend

- [ ] B1 — Add Blocked + Release Queue tabs to `ORDERS_MODULE_TABS`
- [ ] B2 — Build `BlockedOrdersPage` with per-type resolution actions
- [ ] B3 — Build `ReleaseQueuePage` with priority, multi-select, preview, release
- [ ] B4 — Fix `FulfillmentQueuePage` filters + `?order=` param handling

### Intelligence

- [ ] C1 — Floor plan live activity writers (pick_scan_log → liveActivity)
- [ ] C2 — Cross-module intelligence surface (Phase D)

---

## Open Issues / Decisions

| ID | Issue | Decision |
|---|---|---|
| OP-01 | `max_batch_line_items` is line-item based not order-count based | Accepted — starvation guard handles edge cases |
| OP-02 | Priority-flagged orders included before greedy fill | Accepted — Option A |
| OP-03 | Pool is derived view, no physical table | Accepted — avoids drift |
| OP-04 | Spatial sort falls back to location_code ASC when coordinates null | Accepted |
| OP-05 | Pre-release preview is non-blocking — owner can override | Accepted |
```

Now add cross-references to the existing blueprints. In **`docs/blueprints/WMS_process_blueprint.md`**, find the top section and add after the status line:

```tsx
**Cross-references:** OrderPool.md — pool feeds batch release. WarehouseGrid.md — spatial pick route uses floor coordinates. constraint_system_blueprint.md — constraint resolution gates pool entry.
```

In **`docs/blueprints/WarehouseGrid.md`**, under the existing cross-references or at the top, add:

**Cross-references:** OrderPool.md — pick route sort uses position_x/y from warehouse_locations. WMS_process_blueprint.md — pick session consumes spatially-sorted line items.