# Orders Module — Blueprint & Roadmap

**LaSyncro | Last updated: May 25, 2026**
**Status: Sprint 3 in progress**

---

## 1. Vision

The Orders module is LaSyncro's primary execution surface. It is where an SMB operator — owner, admin, or warehouse operator — arrives under pressure, sees exactly what needs to happen today, takes action, and confirms the result. Every design decision in this module is evaluated against one question: does this help an operator with 1-20 people, fulfilling from their own warehouse, making $100k–$50M/year, resolve their daily firefighting faster?

The module must eliminate five operator pain points:

1. "I don't know which orders are blocked and why" → Blocked tab
2. "I don't know what to pick next" → Release Queue tab
3. "I can't see pick/pack progress" → Fulfillment tab
4. "I don't know what shipped and when" → Outbound tab
5. "I don't know what stock is arriving or when" → Inbound tab

---

## 2. Module Structure

**Route:** `/orders`
**Tab bar:** Overview · Blocked · Release Queue · Fulfillment · Outbound · Inbound · Returns

### Tab inventory

| Tab | Route | Status | Backend endpoint |
|---|---|---|---|
| Overview | `/orders` | ✅ Complete | `useOrdersFt2Snapshot` + `useOrdersOperatorSummary` |
| Blocked | `/orders/blocked` | ✅ Complete | `GET /api/v1/orders/constrained` |
| Release Queue | `/orders/pool` | ✅ Complete | `GET /api/v1/wms/order-pool` |
| Fulfillment | `/fulfillment` | ✅ Complete | `GET /api/v1/wms/batches` |
| Outbound | `/orders/outbound` | ✅ Complete — Phase 1 | `GET /api/v1/orders/fulfilled` |
| Inbound | `/orders/inbound` | ✅ Complete — Phase 1 | `GET /api/v1/suppliers/purchase-orders` + `GET /api/v1/suppliers/receive-jobs` |
| Returns | `/returns` | ✅ Complete | 3 sub-tabs: Intelligence · Items · Suppliers |

---

## 3. Design System Rules (enforced, no exceptions)

- **No hardcoded hex values** — CSS variables or `theme.palette.*` only
  - Exception: `STAGE_COLORS` in `OrdersModuleFT2.tsx` — domain pipeline tokens, no DS equivalent yet
- **No inline `style={}` props** — MUI `sx` prop only
- **No `!important`**
- **No `console.log`** — use `console.info` with tagged prefix
- **No cross-module imports** — shared code goes in `packages/shared` or `@lasyncro/ui-ft2`
- **No serif headers on operational modules** — DM Serif Display reserved for Overview page only
- **No dead UI** — checkboxes, buttons, and interactive elements must be wired or removed
- **One change at a time** — audit → propose → approve → implement → verify
- **Always verify with SQL + curl + screenshot** — never assume data matches expectation

### Typography hierarchy (operational modules)

- Page title: DM Sans 22px / weight 500
- Signal line: DM Sans 13px / `var(--ink-3)`
- Section labels: 10px / weight 500 / 0.08em letterSpacing / uppercase / `var(--ink-4)`
- Table headers: 10px / weight 500 / 0.08em letterSpacing / uppercase
- Body: 13px / weight 400
- Monospace (order IDs): `fontFamily: 'monospace'`

### Layout pattern (operational module pages)

```ts
[Header: title + signal line + page actions]
[Alert banner — conditional, data-driven]
[Context zone — 2-column: pulse left, money+stage right]
[Action surface — primary interactive table]
```

---

## 4. Data architecture

### Key data sources

| Source | Purpose |
|---|---|
| `useOrdersFt2Snapshot` | Canonical FT2 snapshot — revenue, counts, operational control |
| `useOrdersOperatorSummary` | Aging orders, constraint counts, queue counts, imminent SLA breachers |
| `GET /api/v1/orders/constrained` | Blocked orders with constraint type, age, revenue |
| `GET /api/v1/wms/order-pool` | Pool-eligible (unconstrained, unbatched) orders |
| `GET /api/v1/wms/batches` | Active pick/pack batches |
| `POST /api/v1/wms/orders/:orderId/priority` | Flag order for priority batch inclusion |
| `POST /api/v1/wms/batch/release` | Release batch from pool |

### Order flow (enforced by system)

```ts
Order created
    → constraint scan
    → has active constraint?
        YES → order_constraints (is_active=true) → /orders/blocked
        NO  → order_fulfillment_status (pending) → /orders/pool (Release Queue)
              → batch released → /fulfillment (pick/pack/ship)
              → fulfilled → /orders/outbound (shipped ledger)
```

### Critical invariant

**Blocked orders must never appear in the Release Queue.** The pool endpoint (`GET /api/v1/wms/order-pool`) filters on constraint-free orders. The Overview action queue shows constrained orders — these route to "Unblock →" not "Resolve →".

---

## 5. Completed work — Sprint 3 (May 2026)

### Overview tab

- Full redesign: DM Sans header, 2-column context zone, compact stat cards
- Constraint tags: Overdue / Out of stock / Address issue (replacing generic "Hold")
- SLA humanized: `53d 1h past` not `1271H`
- Value column wired: `revenue` added to `agingOrders` shape (backend + frontend)
- Checkbox → priority flag → navigate to Release Queue (wired end-to-end)
- Priority toolbar only appears for pool-eligible (unconstrained) orders
- Operation Pulse and Money/Stage panels equal height (CSS grid fix)

### Blocked tab

- Data source mismatch fixed: response shape `{ data: rows }` → `{ orders, total }`
- Duplicate rows eliminated: `order_age_snapshot` multi-version fan-out fixed with `DISTINCT ON` subquery
- `external_order_id` added to constrained orders response and display
- Auto-expands first non-empty constraint group on navigation
- Serif header removed

### Backend fixes

- `orders.constrained.controller.ts`: deduplicated via subquery on `order_age_snapshot`, joined `external_order_identity_map`
- `OrdersOperatorFacts.service.ts`: `revenue` field added to `agingOrders` via `order_revenue_units` join

---

## 6. Known issues & backlog

| ID | Priority | Tab | Description |
|---|---|---|---|
| ORD-POOL-02 | 🟡 P2 | Release Queue | Zones column shows `—` — zone data not populated |
| ORD-FLFL-02 | 🟡 P2 | Fulfillment | 3D/2D warehouse map not integrated |
| ORD-RET-02 | 🟡 P2 | Returns | No restock action from returns surface |
| ORD-VAL-01 | 🟡 P2 | Overview | Value column uses compact format (`$1,292`) — should show full precision (`$1,291.90`) for revenue at risk |
| ORD-SERIF-01 | 🟡 P2 | Release Queue | "Release queue. Pick what ships next." still serif |
| PROJ-01 | 🔴 P1 | Backend | `orderFulfillmentProjection.ts` hardcodes `incomingStatus = 'pending'` — projection can never advance orders to `fulfilled` through the event pipeline |
| ORD-OUT-01 | 🟡 P2 | Outbound | Pulse stats computed from paginated rows — needs dedicated summary endpoint for accurate this-week counts |
| ORD-OUT-02 | 🟡 P2 | Outbound | click on each order and pop up the orders details page |
| RET-SUP-01 | 🟡 P2 | Returns/Suppliers | Supplier linkage null — requires receive jobs to be completed via mobile `ReceiveJobScreen` |
| RET-REASON-01 | 🟡 P2 | Returns/Intelligence | `by_reason` always null — Shopify refund reason not mapped during sync |
| RET-THEME-01 | 🟡 P2 | Returns/Intelligence | `ReturnsOverviewPage` still uses hardcoded hex in `useReturnsTheme()` — migration to CSS variables pending |

---

## 7. Outbound tab — design specification

### What it is

A shipped orders ledger. Every order that has left the warehouse, visible to owners and admins. Replaces the manual Shopify export that operators currently do weekly.

### What it is NOT (yet)

- Not a carrier tracking surface — no tracking numbers, no delivery status. No shipping integration exists. This is Phase 2.
- Not a fulfillment execution surface — that's the Fulfillment tab.

### Data available now

- `external_order_id` — Shopify order number
- `total_price` — order value
- `order_created_at` — when ordered
- `fulfilled_at` — when marked fulfilled
- Derived: `hours_to_fulfil` (creation → fulfilled)

### Data NOT available (Phase 2)

- Tracking number
- Carrier name
- Delivery status
- Last scan location

### Page structure

```ts
[Header: "Outbound" + signal line: "48 shipped this week · $47,401 collected"]
[Pulse: 4 stat cards — Shipped this week · Revenue collected · Avg fulfilment time · Pending delivery*]
[Ledger table: Order · Value · Ordered · Shipped · Time to fulfil · Tracking*]
* = Phase 2, placeholder column with "Coming soon" affordance
```

### Backend requirement

New endpoint: `GET /api/v1/orders/fulfilled`

- Auth: `authenticateToken`
- Query: `order_fulfillment_status` (status = 'fulfilled') + `orders` + `external_order_identity_map`
- Pagination: limit/offset
- Sort: `fulfilled_at DESC`

### Platform split

- **Webapp**: ledger view, summary pulse, future delivery status
- **Mobile**: ship confirmation is tail end of fulfillment flow (already built) — no separate outbound screen needed

---

## 8. Inbound tab — design specification

### What it is

A purchase order status board and receive job outcome surface for owners and admins. Answers: what's coming, when, how much, what arrived, what was shorted, what exceptions were raised.

### What it is NOT

- Not a receiving execution surface — that's the mobile `ReceiveJobScreen` (fully built)
- Not a duplicate of the Suppliers portal — that's at `/suppliers-portal`

### Infrastructure (fully built, 0 seed data)

**Backend endpoints (all at `/api/v1/suppliers/`):**

- `GET /` — suppliers list with ratings
- `POST /` — create supplier
- `GET /purchase-orders` — all POs with line item counts
- `POST /purchase-orders` — create PO
- `PATCH /purchase-orders/:poId/status` — advance PO lifecycle
- `GET /receive-jobs` — all receive jobs
- `POST /purchase-orders/:poId/receive-jobs` — create receive session
- `GET /receive-jobs/:jobId` — job + lines detail

**PO lifecycle:**

draft → ordered → confirmed → in_production → shipped → partially_received → received → cancelled

**Mobile (operators):** `ReceiveJobScreen` — claim → inspect line by line → report exceptions → close → stow tasks created

**Role split:** Only owner/admin can create POs and advance status. Operators execute receive jobs on mobile.

### Page structure

```ts
[Header: "Inbound" + signal line: "3 POs open · 2 arriving this week"]
[Pulse: 4 stat cards — Open POs · Units expected · Arriving this week · Exceptions this month]
[PO status board: grouped by status — In transit · Partially received · Awaiting confirmation]
[Each PO row: Supplier · Expected date · Units ordered/received · Status · Action]
```

### The critical missing link

When a receive job closes, `inventory_movements` must receive a credit entry for accepted quantities. This is what unblocks inventory-constrained orders automatically. Without this, the inbound → blocked orders feedback loop is broken.

**Required backend work:**
In `closeReceiveJob` service: after job closes, for each accepted line item, insert into `inventory_movements` with `movement_type = 'receive'` and `quantity_delta = units_accepted`.

### Blocked orders connection

When accepted units satisfy a blocked order's inventory constraint, surface: "N blocked orders can now be released." This is the highest-value feature in the entire Inbound tab.

### Platform split

| Action | Webapp | Mobile |
|---|---|---|
| Create supplier | ✅ Owner/admin | ❌ |
| Create PO | ✅ Owner/admin | ❌ |
| Advance PO status | ✅ Owner/admin | ❌ |
| View PO board | ✅ Owner/admin | ❌ |
| Execute receive job | ❌ | ✅ Operator |
| Report exceptions | ❌ | ✅ Operator |
| View receive outcomes | ✅ Owner/admin | ✅ Summary only |
| Stow put-away | ❌ | ✅ Operator |

---

## 9. Carrier tracking — Phase 2 (workshop required)

**Trigger:** When a shipping integration is connected (EasyPost, Shippo, or Shopify Fulfillment API enrichment).

**What's needed:**

- Tracking number storage (column on `order_warehouse_status` or new `shipment_tracking` table)
- Carrier webhook ingestion (delivery events: in_transit, out_for_delivery, delivered, failed)
- Outbound tab upgrade: tracking number, carrier, status, estimated delivery
- Mobile: label printing at pack station

**Decision required before building:** Which carrier integration comes first? This warrants its own workshop.

---

## 10. Next build sequence

1. ✅ Orders Overview redesign
2. ✅ Blocked tab fix
3. ✅ Value column wired
4. ✅ Priority flag → Release Queue
5. ✅ Outbound tab Phase 1 (shipped ledger)
6. ✅ Inbound tab Phase 1 (PO status board)
7. ✅ Returns tab — Intelligence · Items · Suppliers sub-navigation complete
8. 🔲 Inventory movement credit on receive job close (critical backend)
9. 🔲 Blocked orders → inbound connection (unblock on receive)
10. 🔲 Carrier tracking workshop
11. 🔲 Full precision value display (ORD-VAL-01)
12. 🔲 Release Queue serif fix (ORD-SERIF-01)
13. 🔲 Fulfillment projection bug fix (PROJ-01)

---

## Sprint 4 Fix — PROJ-01 Resolved (May 25, 2026)

**Root cause:** `handleOrderFulfillment.ts` was writing to `domain_events` correctly but the `orderFulfillmentProjection.ts` dead code was never called. The live path was always through `handleOrdersFulfilled` in the projection engine — but the webhook router was crashing on RLS before events reached `domain_events`.

**Fixes applied:**
1. `webhookRouter.ts` — added `SET app.current_tenant` after `shopId` resolution, before ledger write. Resolves RLS violation on `integration_webhook_events`.
2. `handleOrderFulfillment.ts` — no behavioral change needed. Domain event write was already correct.
3. `operators.controller.ts` (TEAM-07) — fixed `u.name` → `CONCAT(u.first_name, ' ', u.last_name)`.

**Verified:** Shopify orders #1166 and #1167 fulfilled via Shopify admin → webhooks arrived → `domain_events` written → projection engine processed → `order_fulfillment_status` updated to `fulfilled` with correct timestamps.

**Pipeline confirmed working:**
Shopify webhook → HMAC verified → `domain_events` insert → projection engine → `handleOrdersFulfilled` → `orderFulfillmentIngestionService.ingestStatus()` inside projection transaction → `order_fulfillment_status.status = fulfilled`
