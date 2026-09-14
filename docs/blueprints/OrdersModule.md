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
| ORD-OVERVIEW-INVENTORY-01 | ✅ Implemented | Overview | "Needs a decision" omitted in-SLA canonical blocks — fixed, see below |
| ORD-FIXTURE-INVMULTI-01 | 🟡 P2 | Verification | No deterministic multi-variant inventory-block browser fixture |
| INV-ACTION-ARCH-01 | 🟡 P2 | Backend | Decouple Sourcing navigation from legacy `resolve_inventory_block` execution |
| ORDER-NEXUS-DIST-STALE-01 | 🔴 P1 | Build | Committed order-nexus `dist` drifted from source — no gate prevents it |
| TEST-ORDER-NEXUS-MODULEENTRY-01 | 🟡 P2 | Tests | `OrdersModuleFT2.test.tsx` cannot resolve `./ModuleEntry.js` |
| ORD-RANK-CONSISTENCY-01 | 🟡 P2 | Backend | Three competing constraint-ranking definitions |
| ORD-ALLOC-PENDING-01 | 🟡 P2 | Backend | `allocation_pending` lifecycle unaudited |

### ORD-OVERVIEW-INVENTORY-01 | IMPLEMENTED + AUTOMATED VERIFIED + LIVE VERIFIED | 🔴 P1

*Not yet deployed. Commit/push/deploy follow this entry.*

#### Ratified model — WHY vs HOW URGENT

"Needs a decision" has two independent dimensions, and conflating them
was the defect:

```text
WHY BLOCKED   = active merchant-actionable canonical constraint
HOW URGENT    = SLA / age
```

**Invariant**

> An active merchant-actionable canonical order constraint must be
> eligible for Orders Overview "Needs a decision" independently of
> shipping SLA breach, order age, the OrdersOperatorFacts
> `WATCH_FLOOR`, and membership in `agingOrders`.
>
> SLA/age must NEVER be an admission prerequisite.

SLA is urgency metadata, not a gate: an approaching or breached SLA
raises an order's urgency because the objective is customer satisfaction
— getting the order out of the door quickly — but a blocked order needs
a decision from the moment it is blocked, not from the moment it is late.

#### Critical model

Critical contains exactly two populations:

1. merchant-actionable canonical constraints, from constrained-order
   truth (`/api/v1/orders/constrained`);
2. unconstrained SLA-breached orders.

When an order is **both** constrained and SLA-breached:

- the canonical constraint owns the issue group;
- SLA remains urgency metadata;
- the order appears exactly once.

Group mapping (unchanged by this fix — the generalised population made
the existing mapping work without an inventory-specific special case):

| Constraint | Group |
|---|---|
| `customer` | Address issues |
| `inventory` | Out of stock |
| `operational` + `returned_undelivered` | Package returned |
| other actionable `operational` | Operational issues |
| unconstrained SLA breach | Shipping SLA breached |

> **Order Flow ownership clarification — 2026-09-14:** The mapping above remains valid for Orders Overview / `order-nexus`, where returned packages are correctly shown as **Package returned** and route into Returns. The separate `/orders/flow` Blocked Orders rail excludes an order whose only active constraint is `operational` + `returned_undelivered`, because post-shipment recovery belongs to Returns. If that order also carries a genuine customer or inventory blocker, it remains visible for that real blocker. The underlying `returned_undelivered` constraint remains intact as an internal Order Pool release-safety guard. The generic `/orders/flow` operational fallback label is **Operational hold**, never **Pick Exception**.


Empty groups remain hidden.

#### Actionability allow-list

Explicit, in `isMerchantActionableConstraint()`. "Every active
constraint row is actionable" is deliberately NOT the rule.

| `constraint_type` | Actionable |
|---|---|
| `inventory` | yes, **except** `block_type = 'allocation_pending'` |
| `customer` | yes |
| `operational` | yes |
| unknown / unrecognised | **no** — new types opt in deliberately |

`allocation_pending` is excluded because its semantics are **unaudited**
(ORD-ALLOC-PENDING-01), not because it has been ratified as permanently
non-actionable. Nothing here should be read as a decision about it.

#### Watch model

Watch contains aging / approaching-SLA orders needing attention, but NOT
orders already owned by an actionable canonical constraint — such an
order is blocked, not merely aging, and belongs in Critical under its
issue group. It must never appear in both bands.

**`WATCH_FLOOR` was NOT the defect and was NOT modified.** The backend
aging population in `OrdersOperatorFacts.service.ts` is untouched; the
Watch narrowing is a frontend ownership rule only.

#### Copy and counts

- The Critical population is described as "critical order(s)", never
  globally as "SLA-breached" — a freshly out-of-stock order is critical
  but not late.
- SLA-specific terminology stays on the "Shipping SLA breached"
  group/order level, where it remains true.
- Critical order count = unique visible Critical orders (Map keyed by
  `lasyncro_order_id`).
- Issue count = number of non-empty issue groups.
- `operationalControl.constrained_orders` is **not** required to equal
  the Critical count. They are different read models over different
  populations, and forcing equality would be wrong.

#### Original defect (retained for history)

Orders Overview "Needs a decision" admitted SLA-breached
orders plus a `returned_undelivered` exception. Active inventory
constraints that were still **within** SLA were therefore omitted, even
though operational-control correctly counted them as constrained.

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

Also established during the audit and **not** inventory-only: `customer`
and every non-return `operational` block type were excluded by the same
mechanism, and a second, upstream gate exists — the backend
`WATCH_FLOOR` (50% of the SLA window) keeps a fresh order out of
`agingOrders` entirely, so a just-blocked order reached neither Critical
nor Watch. Admission now bypasses both gates by reading canonical truth.

#### Fix

`modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx` only (+133/−81),
plus the authorised module rebuild of its committed `dist`. No backend,
config, seed, or test change.

- the `returned_undelivered`-only constrained path was **generalised**
  to all merchant-actionable canonical constraints — the ORD-RETPKG
  principle applied as originally stated, not as a second special case;
- merge ownership flipped: canonical constraint wins over the SLA/aging
  row, via an explicit `Map` keyed by order id (no ordering reliance);
- an order present in both populations is enriched with the aging row's
  real facts (age, SLA, batch, priority, revenue) — nothing fabricated;
- Watch excludes actionably-constrained orders;
- the Critical signal line no longer says "SLA-breached".

#### Verification

Automated — permanent contracts OV-CONSTRAINT-01..13 in
`tests/unit/ui/order-nexus/OrdersModuleFT2.constraint-admission.test.tsx`:

| Result | Contracts |
|---|---|
| RED → GREEN | 01, 02, 03, 07, 08/09, 10, 12, 13 |
| GREEN guards retained | 04, 05, 06, 11 |

- constraint-admission: **10/10 PASS**
- returned-undelivered: **4/4 PASS**
- critical-order-inspection: **7/7 PASS**
- test ownership: `UNOWNED=0`, `MULTI_OWNED=0`
- frontend `TARGET_ERROR_COUNT=0`; 19 pre-existing global baseline
  errors in untouched files, not repaired

OV-CONSTRAINT-11 guards against over-generalisation (an unratified
constraint type must not silently become a decision); OV-CONSTRAINT-13
permanently protects deterministic Critical/Watch ownership.

Live browser, against the **rebuilt** order-nexus dist, on `/orders`:

- "Out of stock" visible with no SLA prerequisite
- `#800001`, `#800002`, `#800003` all visible
- Critical showed the additional inventory issue group
- the inventory order's modal still exposed "Source this item"
- exact Sourcing routing remained functional

Returned-package regression on the rebuilt dist:

| Order | Group | Action | Route |
|---|---|---|---|
| `#900016` | Package returned | Review return | `/returns/items?returnJobId=e578ed59-a467-49e2-9dc8-2175609db273` |
| `#900099` | Package returned | Process return | `/wms?returnJobId=e07bd232-03b2-7173-3d00-7ffb46b041f1` |

No constrained-order duplication across Critical/Watch was observed in
the available browser fixture. That observation is fixture-limited, so
the durable guarantee is OV-CONSTRAINT-13, not the browser pass.

**Verification workaround no longer required.**
`/orders/flow?constraint=inventory` remains a valid alternate route —
`OrderFlowPage` applies its SLA filter only when `?urgency=sla_breach`
is present — but Overview now surfaces these orders directly.

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

### ORDER-NEXUS-DIST-STALE-01 | OPEN | 🔴 P1

**Problem.** The committed `modules/order-nexus` `dist` was stale
relative to its source. No gate prevents that.

**Evidence at `d4b3265` before the ORD-OVERVIEW-INVENTORY-01 rebuild:**

```text
source      modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
              "returned_undelivered"   → 7 occurrences
committed   modules/order-nexus/dist/ui/pages/OrdersModuleFT2.js
              "returned_undelivered"   → 0 occurrences

source      "constrainedOrders?"       → 1 occurrence
committed   dist/ui/pages/OrdersModuleFT2.d.ts
              "constrainedOrders"      → 0 occurrences
```

The entire ORD-RETPKG returned-package constrained-admission path — and
the `constrainedOrders` / `blockType` prop additions — had never been
built into the committed output.

**Runtime significance.** `apps/frontend/tsconfig.json:35` maps
`@lasyncro/order-nexus` to `src/ui/index.ts`, but
`apps/frontend/vite.config.ts` declares **no** alias for it, so the
browser resolves through the package `exports` field to
`dist/ui/index.js`. TypeScript and Jest therefore see source while the
browser sees `dist`.

A stale `dist` consequently allows:

```text
source truth  ≠  tests  ≠  browser/runtime behaviour
```

This is not theoretical: it explains why "Package returned" rendered in
the browser while the constrained bypass was absent from `dist` — the
returns group was reaching Critical through the SLA/aging path instead.
It also means the ORD-OVERVIEW-INVENTORY-01 rebuild necessarily shipped
the previously-unbuilt ORD-RETPKG work alongside its own change.

**Desired follow-up.** Audit build/CI ownership so an order-nexus source
change cannot merge or deploy with stale committed `dist` — whether by a
CI freshness check, a build step, or removing committed `dist` in favour
of a source alias. Not fixed here.

### TEST-ORDER-NEXUS-MODULEENTRY-01 | OPEN | 🟡 P2

`tests/unit/ui/order-nexus/OrdersModuleFT2.test.tsx` fails to run:

```text
Cannot find module './ModuleEntry.js' from 'modules/order-nexus/src/ui/index.ts'
```

Thrown at that test's own import of the module barrel.
`ModuleEntry.tsx` **exists** both on disk and at `HEAD` — this is a Jest
resolution gap for the `.js`-suffixed TypeScript ESM import, not a
missing file. Suite-level failure contributing `Tests: 0 total`.

Pre-existing baseline, proven independent of ORD-OVERVIEW-INVENTORY-01
and deliberately excluded from that issue's green gate. Not fixed.

### ORD-RANK-CONSISTENCY-01 | OPEN | 🟡 P2

Three competing definitions of "which constraint dominates an order":

- `OrdersOperatorFacts.service.ts:203-210` — `MIN(constraint_type)`,
  i.e. **alphabetical** (`customer` < `inventory` < `operational`)
- `orders.constrained.controller.ts:83-95` — explicit `CASE` ranking
  (`operational` → `customer` → `inventory`)
- `OrdersModuleFT2` — a third order implied by group sequence

Latent divergence risk. Not the cause of ORD-OVERVIEW-INVENTORY-01 and
not touched by it.

### ORD-ALLOC-PENDING-01 | OPEN | 🟡 P2

`allocation_pending` is listed as an inventory block type in
`Constraint_System_Blueprint.md` but was not observed in live data, and
its lifecycle — transient/system-resolved versus merchant-actionable —
has never been audited.

It is currently **excluded** from Overview actionability
(ORD-OVERVIEW-INVENTORY-01) and guarded by OV-CONSTRAINT-11. That is a
conservative default pending this audit, **not** a ratified decision
that it is permanently non-actionable.

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
