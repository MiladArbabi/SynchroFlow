# Orders Module — Blueprint & Roadmap

**LaSyncro | Last updated: May 25, 2026**
**Status: Sprint 3 in progress**

---

## 1. Vision

The Orders module is LaSyncro's primary execution surface. It is where an SMB operator — owner, admin, or warehouse operator — arrives under pressure, sees exactly what needs to happen today, takes action, and confirms the result. Every design decision in this module is evaluated against one question: does this help an operator with 1-20 people, fulfilling from their own warehouse, making $100k–$50M/year, resolve their daily firefighting faster?

The module must eliminate three operator pain points:

1. "I don't know which orders are blocked and why, or what to work on next" → Order Flow tab *(consolidates former Blocked / Release Queue / Fulfillment tabs)*
2. "I don't know what shipped and when" → Outbound tab

*(Former pain point 5, "I don't know what stock is arriving or when," is now owned by the Purchasing module's documentation — Inbound moved out of Orders in the June 2026 nav restructure.)*

---

## 2. Module Structure

**Route:** `/orders`
**Tab bar:** Overview · Order Flow · Outbound

### Tab inventory

| Tab | Route | Status | Backend endpoint |
|---|---|---|---|
| Overview | `/orders` | ✅ Complete | `useOrdersFt2Snapshot` + `useOrdersOperatorSummary` |
| Order Flow | `/orders/flow` | ✅ Complete — consolidated | Merges former Blocked/Release Queue/Fulfillment views. `/orders/blocked`, `/orders/pool`, `/fulfillment/*` now redirect here (`LifecycleRouteHost.tsx`) |
| Outbound | `/orders/outbound` | ✅ Complete — Phase 1 | `GET /api/v1/orders/fulfilled` |

**Moved out of this module (nav restructure, June 2026):**

- **Inbound** (`/orders/inbound`) → now a Purchasing concern. Its own design spec (§8 below) explicitly forbids it from duplicating Suppliers Portal's receive-execution behavior; current code violates that — tracked separately, not yet resolved.
- **Returns** (`/returns`) → now lives in **Returns & Resolution Center**, paired with Product Issues (former Problem Center). See new `ReturnsResolutionModule.md` (pending).

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
| ORD-OVERVIEW-INVENTORY-01 | 🔴 P1 | Overview | "Needs a decision" omits in-SLA inventory blocks — see below |
| ORD-FIXTURE-INVMULTI-01 | 🟡 P2 | Verification | No deterministic multi-variant inventory-block browser fixture |
| INV-ACTION-ARCH-01 | 🟡 P2 | Backend | Decouple Sourcing navigation from legacy `resolve_inventory_block` execution |

### ORD-OVERVIEW-INVENTORY-01 | OPEN | 🔴 P1

**Defect.** Orders Overview "Needs a decision" admits SLA-breached
orders plus a `returned_undelivered` exception. Active inventory
constraints that are still **within** SLA are therefore omitted, even
though operational-control correctly counts them as constrained.

**Root cause.** Grouping admission logic in
`modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx`:

- `:451` `allBreachedOrders = allAgingOrders.filter(o => o.isShippingSlaBreached)`
- `:465-466` the constrained payload is filtered to
  `constraint_type === 'operational' && block_type === 'returned_undelivered'`
  before the merge
- `:483-486` `criticalOrders` = those two populations only
- `:506-509` the "Out of stock" group filters `criticalOrders`, so an
  inventory order can only appear if it is **also** SLA-breached
- `:537` an empty group is dropped, so nothing is rendered at all

The ORD-RETPKG comment at `:458-464` states the correct principle —
canonical `order_constraints` truth "must NOT depend on the SLA/aging
population" — but implements it as a returned-package-only special case.
An active oversell has the same property; the generalisation was never
made.

**Evidence (2026-09-02).** Three active `inventory`/`oversell`
constraints existed (`#800001-800003`), each with a valid variant
`target_id`, a pending `resolve_inventory_block` decision, and remaining
demand. `orders_operational_control_snapshot` was fresh and correct
(`constrained_orders = 5`, `queue_awaiting_inventory = 3`). A SQL mirror
of `orders.constrained.controller.ts` returned all three rows. All three
had `is_shipping_sla_breached = false` at age ~0.02 h, so none entered
`criticalOrders`.

Header vs card, both correct for their own read model:

```text
header  "5 constrained"     = snapshot.constrained_orders
                            = 3 inventory + 2 returned_undelivered
card    "9 orders / 2 issues" = criticalOrders
                            = SLA-breached (8) ∪ returned_undelivered (2)
```

The two disagree by exactly the 3 inventory orders the card cannot
represent.

**Scope.** Pre-existing defect in the order-nexus module, independent of
ORD-DECISION-01 Slice 2 — that slice changed `OrderDetailModalBody` and
the backend decision/execute path, and could neither cause nor fix this.
Not fixed in Slice 2. A fix requires an authorised module rebuild
(`modules/order-nexus/dist/...`) plus its own tests.

**Workaround for verification.** `/orders/flow?constraint=inventory`
reaches the same orders — `OrderFlowPage` applies its SLA filter only
when `?urgency=sla_breach` is present.

### ORD-FIXTURE-INVMULTI-01 | OPEN | 🟡 P2

No deterministic **multi-variant** inventory-block browser fixture
exists in any seed mode. The existing REV-HARD-05 QA fixture
(`apps/backend/seeds/dev_seed.ts`, `DEV_SEED_MODE=full_identity`) seeds
three zero-stock orders with exactly **one** blocked variant each, so a
live browser cannot demonstrate two independent "Source this item"
actions on one order.

This is a **verification-fixture gap, not an untested product
contract** — INV-RED-08 is permanently protected by
`tests/unit/ui/orders/OrderDetailModalBody.inventory-sourcing.test.tsx`.

Related gate to be aware of: `npm run dev:full-reset` uses
`DEV_SEED_MODE=full_data` and runs no SQL seeds, so it produces **no**
inventory-blocked and **no** returned-package fixtures. Only
`npm run dev:full-seed` (`full_identity` + SQL seeds + rebuild) does.

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

**CORRECTED 2026-07-01:** this section's original framing was outdated. `receiveJob.service.ts` already upserts `inventory_truth` directly (`on_hand_quantity`, `available_quantity`, `sellable_quantity`) on job close — confirmed live in code, no `inventory_movements` intermediary needed for that specific read path.

**The real gap, confirmed 2026-07-01** (full trace in `demand-velocity-reorder-playbook.md` §6): receiving stock updates `inventory_truth` correctly, but nothing triggers constraint re-evaluation for orders waiting on that stock. `receiveJob.service.ts` writes zero `domain_events`, and the constraint evaluator only runs inline inside `processDomainEvent` — there is no scheduled sweep. A previously-blocked order stays blocked in `order_constraints` until an unrelated event touches it, or an operator manually re-triggers resolution. Tracked as DF-04 in the demand-velocity playbook.

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
6. ✅ Inbound tab Phase 1 (PO status board) — ⚠️ scope-creep flagged: now performs receive-execution actions §8 explicitly says it shouldn't
7. ✅ Returns tab — Intelligence · Items · Suppliers sub-navigation complete — *(ownership moved to Returns & Resolution Center, June 2026)*
8. 🔲 Inventory movement credit on receive job close (critical backend)
9. 🔲 Blocked orders → inbound connection (unblock on receive) — re-scoped 2026-07-01, see DF-04 in demand-velocity-reorder-playbook.md for the confirmed mechanism gap — re-scoped 2026-07-01, see DF-04 in demand-velocity-reorder-playbook.md for the confirmed mechanism gap
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
