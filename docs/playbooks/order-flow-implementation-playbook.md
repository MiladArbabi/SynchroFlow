# LaSyncro Order Flow Implementation Playbook

---

## 1. Purpose

This playbook documents the design, implementation progress, product logic, technical pitfalls, and current state of the new **Order Flow** surface in LaSyncro.

The goal is to replace the fragmented operational flow:

```text
Blocked Orders
Release Queue
Fulfillment
```

with one unified working surface:

```text
Order Flow
```

The purpose is **not** to merge all operational states into one flat table. The purpose is to give warehouse admins and owners one clear place to understand and act on the order lifecycle:

```text
Blocked → Release Pool → Fulfillment
```

The core principle is:

```text
One surface, separate operational states.
```

Blocked orders remain blocked. Clean orders enter the release pool. Released batches enter fulfillment.

---

## 2. Product Fundamentals

### 2.1 Orders Must Pass Through a Clean Operational Gate

Orders should not be released to the warehouse floor unless they are eligible.

An eligible release-pool order must be:

```text
constraint-free
unbatched
pending or processing
inside the current shop
```

The backend order-pool query already follows this rule by excluding orders with active `order_constraints`, excluding orders already in `pick_batch_orders`, and requiring fulfillment status to be `pending` or `processing`.

This means problematic orders should not normally appear in the release pool.

### 2.2 Blocked Orders Are Not a Global Stop Sign

Blocked orders should **not** block the whole operation.

A blocked order means:

```text
This specific order cannot move forward until its issue is resolved.
```

It does **not** mean:

```text
No other orders can be released.
```

Therefore, the **Order Flow** UX must not auto-focus the user into blocked orders every time blocked count is greater than zero. In a real warehouse, there will often be some blocked orders.

### 2.3 Equal Visibility, Not Frequency-Led (revised 2026-06-25)

**Original principle (kept for history):** release-pool work is the most frequent daily action, so blocked orders should stay behind a compact alert + panel rather than occupy equal space.

That principle is superseded. The actual shipped target gives Blocked, Pool, and Fulfillment **equal persistent visual weight** as three side-by-side columns ("Blocked → Pool → Fulfillment, read left to right"). Severity within each column is now signalled by content (reason tags, age, stalled flags), not by whether the column itself is visible at all.

### 2.4 Truth Over Optimistic UX

If a user selected orders and some are not released, the UI must say exactly what happened.

**Bad UX:**

```text
Release failed.
```

**Better UX:**

```text
#1048 was not released because it is now Out of Stock.
```

The frontend should **not** guess the reason. The backend must return the reason.

---

## 3. Target UX Model

The new visible Orders navigation should be:

```text
Overview
Order Flow
Outbound
Inbound
Returns
```

The removed visible tabs are:

```text
Blocked
Release Queue
Fulfillment
```

These legacy pages/routes can continue to exist internally for compatibility, but they should no longer be primary user-facing navigation once **Order Flow** is active.

### 3.1 Order Flow Layout (revised 2026-06-25)

The target page structure is a **3‑column board**, read left to right:

```text
Order Flow header (rollup line)
Blocked orders column
Order pool column
Fulfillment column
```

Each column is self-contained: header states its entry criteria, body lists/cards, footer (where relevant) holds the column's primary action.

### 3.2 Header

The header should communicate live operational state:

```text
10 blocked · $21,899 held · 6 ready to release · 1 batch active
```

### 3.3 Blocked Orders Column

**Entry criteria:** any order with an active row in `order_constraints`.

**Card per order shows:**

```text
order id
value
reason tag (constraint_type, operator-facing label)
recommended_action.type (or "Manual review required")
age since creation
```

**Operator‑facing labels:**

```text
operational → Overdue
inventory → Out of Stock
customer → Address Issue
```

System words should **not** leak to the operator when a more useful label exists.

**No "Phantom" category exists.** `constraint_type` is a hard DB enum — `inventory | customer | operational` only (`order_constraint_events` migration). Any UI/design reference to a 4th "Phantom" category was based on the original target mockup, not actual data — confirmed false 2026-06-25.

**Reason‑specific resolution** is supported only where a real canonical correction path exists.

- For `customer:incomplete_address`, the operator can open **Order Detail** and use **Correct shipping address**. The address correction writes through `PATCH /api/v1/orders/:orderId/shipping-address`; the active customer constraint remains authoritative until normal reconciliation re-evaluates and resolves it. The UI must **never** clear the blocker optimistically.
- Inventory and other blocker workflows remain separate and must not be inferred from the customer‑address path.

### 3.4 Order Pool Column

**Entry criteria (unchanged):** constraint‑free, unbatched, pending or processing, inside the current shop.

**Table:**

```text
selection checkbox
priority flag
order id
value
line count
unit count
age
zones
```

**Footer:**

```text
live selection summary (N selected · only selected orders will be released)
line items / units to pick, against max_batch_line_items
operator assignment
Release wave to floor
```

**Important copy:** "Pickers see it on their mobile instantly."

**Release model (clarified 2026-06-25):** exactly **ONE** batch per release action — either the full eligible pool (greedy‑filled to `max_batch_line_items`), explicitly selected orders only (exclusive), or selected orders with the remaining batch capacity greedy‑filled from the rest of the pool. There is **no** per‑zone batching and **no** multi‑batch release in a single action — any UI implying "Release N batches" in one click is incorrect.

### 3.5 Fulfillment Column

**Entry criteria:** batches returned by `GET /api/v1/wms/batches` (excludes `pack_complete` and `cancelled` server‑side).

**Card per batch shows:**

```text
batch id
status (Picking / Picked / Packing / Packed)
4-stage stepper
time in current stage
line/unit counts
picker or packer name, once assigned
```

**No manager stage advancement.** Claim, pick-complete, and pack-complete remain operator-owned transitions and do not belong on Order Flow.

**Pending-batch cancellation (BATCH-CANCEL-UNCLAIMED-01, 2026-08-17):** a batch that is still `pending` and unclaimed may be cancelled from its Fulfillment card. The action uses an inline confirmation inside the existing card and calls `POST /api/v1/wms/batch/:batchId/cancel`. Once the batch leaves `pending`, cancellation is rejected.

Cancellation is an atomic unwind, not deletion: the batch is preserved as `cancelled`; its batch-level `reservation_hold` movements are reversed with equal negative `reservation_release` movements; `inventory_truth.reserved_quantity` is reduced while `available_quantity` is restored; and `pick_reservation_allocations` plus `pick_batch_orders` are removed.

After success, the Fulfillment and Order Pool queries are invalidated immediately. Constraint-free orders return to the Order Pool, while normal constraint rules continue to keep blocked orders out of the pool.

**"Shipped"** is intentionally not a stage here: per `POST /api/v1/wms/batch/:batchId/ship`, shipment is confirmed per‑order, not as a pick‑batch status transition. A shipped order leaves Fulfillment entirely and is tracked in Outbound.

**Stalled‑batch highlighting:** deferred pending integration with the existing `alerts` table (`alert_type: 'wms_operator_idle'`), not a frontend‑computed threshold — `shop_wms_settings.idle_alert_threshold_minutes` is already the source of truth server‑side and should not be duplicated.

---

## 4. Theme and Styling Rules

All new UX must be theme‑aware and compatible with both light and dark modes.

### 4.1 Allowed Styling Source

Use existing CSS variables and theme surfaces only.

**Preferred variables:**

```text
--bg
--bg-2
--bg-3
--surface
--rule
--rule-2
--accent
--accent-ghost
--accent-border
--ink
--ink-2
--ink-3
--ink-4
```

### 4.2 Avoid

Do **not** introduce hardcoded visual colors:

```text
rgba(...)
#FFFFFF
#000000
#FF6B2B
```

**Exception:** `#` in rendered order numbers such as `#1048` is not a color and is acceptable.

### 4.3 Verification Command

Use:

```zsh
grep -n "rgba(\|#[A-Fa-f0-9]" apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx
```

**Expected result:**

```text
No hardcoded visual colors.
```

If this grep catches an order‑number template such as `#${order.external_order_id}`, that is acceptable because it is not a color.

---

## 5. Files Touched So Far

### 5.1 New Primary Page

**File:** `apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx`

**Purpose:**

```text
Unified Orders working surface.
Combines blocked review, release pool, wave builder, and fulfillment status.
```

### 5.2 Shared Release‑Pool Hook

**File:** `apps/frontend/src/pages/wms/useOrderPool.ts`

**Purpose:**

```text
Shared data/actions for:
- ReleaseQueuePage
- OrdersFT2Page priority action
- OrderFlowPage
```

**Current responsibilities:**

```text
GET /api/v1/wms/order-pool
POST /api/v1/wms/orders/:orderId/priority
POST /api/v1/wms/batch/release
```

### 5.3 Constrained Orders Hook

**File:** `apps/frontend/src/pages/orders/useConstrainedOrders.ts`

**Purpose:**

```text
Fetch blocked/constrained orders from canonical backend source.
Expose operator-facing constraint labels.
```

**Important exported helpers:**

```ts
getConstraintLabel();
getAgeLabel();
useConstrainedOrders();
```

### 5.4 Route Host

**File:** `apps/frontend/src/lifecycle/LifecycleRouteHost.tsx`

**Changes made:**

```text
/orders/flow route added.
Legacy split routes redirected to /orders/flow:
- /orders/blocked
- /orders/pool
- /fulfillment/*
Unused lazy imports removed.
```

### 5.5 Orders Module Tabs

**File:** `apps/frontend/src/pages/ft2-pages/ordersModuleTabs.ts`

**Visible tabs updated to:**

```text
Overview
Order Flow
Outbound
Inbound
Returns
```

### 5.6 Runtime Nav

**File:** `apps/frontend/src/runtime/navBootstrap.ts`

**Left nav Orders children updated to:**

```text
Overview
Order Flow
Outbound
Inbound
Returns
```

### 5.7 Backend Pick Batch Service

**File:** `apps/backend/src/services/wms/pickBatch.service.ts`

**Changes made:**

```text
ReleaseBatchResult extended.
SkippedReleaseOrder added.
Exclusive selected-release behavior protected.
Backend now has a response channel for skipped selected orders.
```

### 5.8 CPT Risk Matrix + Cross‑Linking (v1)

**File:** `apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx`

**Shipped:**

- `bucketByCpt(createdAtIso, hoursToCpt)` → `'overdue' | 'today' | 'ahead'` (file‑local, not exported — react‑refresh).
- `cptMatrix` `useMemo`: pool + blocked grouped into `{ overdue, today, ahead }` × `{ blocked, pool, picking, packing, valueAtRisk }`.
- CPT cutoff from `useLiveCapacity` (60s), `cpt_local/hours_to_cpt`.
- Matrix JSX: stage rows × bucket columns, danger ring on `overdue·blocked`, `$ at risk` footer, theme tokens only.
- Cross‑linking: `cptFilter` state; click a blocked/pool cell → `visibleBlocked`/`visiblePool` filter to that cell; active‑cell ring; clear chip in header. Release/selection still read unfiltered `poolOrders`.

**Data caveats:**

- x‑axis buckets on `order_created_at` (ISSUE‑10: `promised_ship_by` defined but unwritten/all‑NULL).
- `picking`/`packing` parked in `'today'` (no per‑batch deadline until ISSUE‑4).

**Cadence:** batches 10s on this page (per‑call override); blocked/pool via existing hooks.

Per‑carrier CPT columns + `promised_ship_by` writer (GitHub #1017) still deferred. Iso twin is **NOT** deferred — see §5.9, status corrected 2026-06-25: shipped then removed, not currently present.

### 5.9 Isometric Floor Twin (REMOVED — see status note)

**Status corrected 2026-06-25 (code audit):** shipped in commit `670977ed`
("v1 iso twin shipped and documented"), then removed when the full page
rewrite landed in `27999b71` ("orders flow module rewired fully"). This
section was never updated after the removal, which is why §7 separately
(and correctly) lists it under "Not done yet" — both statements were true
at different points in time, just never reconciled until now.

The `IsometricCanvas` component itself was **NOT** deleted — it's still live in
`@lasyncro/shared/ui` and actively used by `modules/floor-planning`
(`FloorPlanningModuleFT2.tsx`, `CanvasEditor.tsx`). Re‑adding it to Order
Flow would be a re‑wire against an existing, working component, not a
from‑scratch build.

**Original v1 documentation preserved below for reference:**

---

**File:** `apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx`

**Model:** one authored map, many stories. The warehouse map is built once in
Floor Planning (Setup/Canvas) and stored in `warehouse_locations`. Every surface
renders the **SAME** `IsometricCanvas`; only the overlaid data/story changes. Order
Flow narrates the order‑fulfillment story on it.

**Zone source:**

- `useFloorPlanning()` → `data.zones` (`WarehouseZone[]`), from `GET /api/v1/floor-planning/layout`
  (controller returns `{ zones, product_barcodes }`). Canonical map — same hook the
  Floor Planning Setup surface uses. **NOT** `useWarehouseGrid` (that returns `{locations}`).

**Batch → zone (ISSUE‑4, resolved frontend‑only):**

- Batches carry no zone column. Derived client‑side: `usePickBatchLineItems(batchId)`
  → `line_items[].location_code` → `Set` → passed as `IsometricCanvas filteredCodes` to
  light active‑pick zones. No backend change.

**v1 scope:**

- Single focused batch only: first batch with status `picking|packing`. `filteredCodes`
  lit from its line items. `filteredCodes` omitted (`undefined`) when none → full floor shown.
- Canvas from `@lasyncro/shared/ui`, token‑sourced (`--zone-*`).
- Guards: `zones.length === 0` → "build it in Floor Planning"; no active batch → label only.

**Deferred (as of original v1 ship — not re‑verified against current code):**

- ISSUE‑4d — light ALL active batches at once (`usePickBatchLineItems` is single‑batchId;
  hooks can't loop). Needs aggregate `useActiveBatchZones` hook. v1+.
- Shared CPT‑urgency tint on zones (match matrix palette) — needs new canvas overlay prop.
- Matrix‑cell ↔ zone click‑sync — extends cross‑linking to the iso.

---

## 6. Backend Release Logic

### 6.1 Normal Release

When the user releases without selecting specific orders:

```text
Backend releases a normal batch from eligible orders.
Priority-flagged orders come first.
Remaining orders fill oldest-first.
Batch respects max_batch_line_items.
```

### 6.2 Selected Release

When the user selects specific orders in **Order Flow**:

```text
Frontend sends selected IDs as priority_order_ids.
Frontend also sends exclusive: true.
Backend validates selected IDs against the eligible pool.
Only valid selected IDs should be released.
No greedy fill should happen in exclusive mode.
```

### 6.3 Why Backend Revalidation Is Required

Even if the release pool was clean when the frontend loaded, the order state can change before the user clicks release.

Examples:

```text
Order becomes blocked.
Order is already batched somewhere else.
Order fulfillment status changes.
Order disappears from the eligible pool.
```

The backend **must** revalidate at click‑time.

### 6.4 Skipped‑Order Feedback

The backend now has the shape needed to explain skipped orders:

```ts
export type SkippedReleaseOrderReason =
  | 'blocked'
  | 'already_batched'
  | 'status_changed'
  | 'not_in_pool';

export interface SkippedReleaseOrder {
  order_id: string;
  external_order_id: string | null;
  reason: SkippedReleaseOrderReason;
  label: string;
}
```

The frontend can use this to show:

```text
#1048 · Out of Stock
#1051 · Already in a pick batch
#1052 · Status changed
```

### 6.5 Important Backend Behavior

The backend should return skipped‑order explanations before generic `null` returns where possible.

**Correct behavior:**

```text
Exclusive selected release, selected orders invalid → return skipped_orders.
Normal release, no eligible orders → return null.
```

---

## 7. Current Implementation Status

### ✅ Done

- Created `OrderFlowPage`.
- Added `/orders/flow` route.
- Updated Orders module tab bar.
- Updated runtime left nav.
- Redirected `/orders/blocked` to `/orders/flow`.
- Redirected `/orders/pool` to `/orders/flow`.
- Redirected `/fulfillment/*` to `/orders/flow`.
- Removed unused legacy lazy imports from route host.
- Created shared `useOrderPool` hook.
- Updated `ReleaseQueuePage` to use shared hook.
- Updated `OrdersFT2Page` to use shared `useSetPriority`.
- Added blocked alert strip.
- Added compact blocked review panel.
- Added release‑pool table.
- Added next wave builder.
- Added fulfillment live strip.
- Made selected release exclusive.
- Added backend skipped‑order response contract.
- Updated frontend `ReleaseBatchResult` contract.
- Started frontend skipped‑order banner wiring.
- Cleaned backend indentation around skipped‑order block (`pickBatch.service.ts:132-208`).
- Fixed hardcoded `#fff` on release button → `theme.palette.common.white` (`OrderFlowPage.tsx:671`).
- Fixed stale/misleading code comments (`OrderFlowPage.tsx`, `useOrderPool.ts`) and a broken indentation block (`blockedByBucket`/`blockedBannerSummary`).
- Added `blockedByReason` grouping by `constraint_type`, surfaced in the blocked banner.
- Added persistent reason‑tagged **Blocked orders column** (target‑IA Phase 1) — additive, alongside existing banner/Drawer pending Phase 4 cleanup.
- Added consolidated **Order pool column** (target‑IA Phase 2) — additive, alongside existing Next‑Wave panel/pool table pending Phase 4 cleanup.
- Added compact **Fulfillment batch cards** (target‑IA Phase 3a) — read‑only monitoring (status, 4‑stage stepper, time‑in‑stage); no advance‑stage actions, see §3.5.
- Reconciled this playbook's isometric‑twin contradiction and rewrote §2.3/§3 to match the actual 3‑column target.

### 🔄 In Progress

- Verify `releaseSuccess` banner guard around nullable `batchId`.
- Wire `skipped_orders` fully into frontend release feedback.
- Run targeted TypeScript build after frontend/backend contract changes.

### ❌ Not Done Yet

- Blocked‑order resolution actions inside the new Blocked orders column (reason‑specific workflows — e.g. retry label, verify address — explicitly deferred, not yet scoped).
- Deep‑link panel state such as `/orders/flow?panel=blocked`. — **OBSOLETE:** referred to the old Drawer pattern, which the target architecture doesn't use. No replacement currently planned.
- Phase 3b — stalled‑batch highlighting via the existing `alerts` table (`alert_type: 'wms_operator_idle'`); needs an alerts‑fetching‑hook audit first. Do **not** compute a separate frontend threshold — `shop_wms_settings.idle_alert_threshold_minutes` is the single source of truth server‑side.
- Phase 4 — replace the old 2‑column shell (Next‑Wave panel + CPT‑risk matrix + old pool table + blocked banner/Drawer) with the new 3‑column board as the only UI; remove the now‑dead code. Old and new UI currently coexist on the page side‑by‑side — this is verification scaffolding, not the final state.
- Permission‑aware release action UI.
- Operator role UX check.
- Final removal or archival of old split pages.
- Automated tests for exclusive selected release.

---

## 8. Current Known Pitfalls

### 8.1 Nullable `pick_batch_id`

Backend can now return:

```ts
pick_batch_id: null
```

This happens when no batch is created, but skipped‑order information exists.

Frontend must **never** call:

```ts
releaseSuccess.batchId.slice(...)
```

unless guarded by:

```tsx
releaseSuccess.batchId && (...)
```

### 8.2 Old Route Links

Because old split routes now redirect to `/orders/flow`, new UI should **not** link to:

```text
/orders/blocked
/orders/pool
/fulfillment
```

Use local anchors, local panels, or future query params instead.

### 8.3 `replaceAll` TypeScript Target Issue

Do **not** use:

```ts
string.replaceAll(...)
```

Use:

```ts
string.replace(/_/g, ' ')
```

**Reason:** Current TypeScript lib target does not support `replaceAll`.

### 8.4 Theme Safety

Do **not** introduce hardcoded colors.

**Bad:**

```ts
bgcolor: 'rgba(229,72,77,0.07)'
```

**Good:**

```ts
bgcolor: 'var(--accent-ghost)'
border: '1px solid var(--accent-border)'
```

### 8.5 Pool Must Stay Clean

Do **not** design UX as if blocked orders normally live in the release pool.

**Correct mental model:**

```text
Blocked orders are reviewed beside the release pool.
They do not belong inside the release pool.
```

### 8.6 Backend Truth First

Frontend should **not** guess why an order was skipped.

**Bad:**

```text
Probably blocked.
```

**Good:**

```text
Backend says reason = blocked, label = Out of Stock.
```

---

## 9. Current User‑Facing Release Feedback Target

**When all selected orders release:**

```text
3 orders released · Batch 8F3A21B0 is now active in fulfillment.
```

**When some selected orders release and some are skipped:**

```text
2 orders released · Batch 8F3A21B0 is now active in fulfillment.
1 order not released · #1048 · Out of Stock
```

**When no selected orders release:**

```text
2 orders not released · #1048 · Out of Stock · #1051 · Already in a pick batch
```

**When no batch is created and no skipped‑order data exists:**

```text
No orders were released. The release pool may have changed. Refresh and try again.
```

---

## 10. Next Immediate Steps

### Step 1 — Verify the Release Banner Block

Inspect:

```zsh
nl -ba apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx | sed -n '520,545p'
```

Confirm that:

```tsx
releaseSuccess.batchId.slice(0, 8)
```

is guarded by:

```tsx
releaseSuccess.batchId && (...)
```

If not, patch it immediately.

### Step 2 — Clean Backend Formatting

The backend skipped‑order block currently works logically, but indentation around the newly inserted section is messy.

Clean:

```text
apps/backend/src/services/wms/pickBatch.service.ts
```

around lines roughly:

```text
121–208
```

Do **not** change behavior while cleaning formatting.

### Step 3 — Finish Skipped‑Order Frontend Banner

Make sure `OrderFlowPage` displays:

```text
released count
batch ID only when non-null
skipped order count
first 3 skipped order labels
+N more
```

### Step 4 — Run Targeted Builds

After backend/frontend contract is fully wired:

```zsh
cd /Users/miladarbabi/Codes/projects/SynchroFlow/apps/frontend || exit 1
npx tsc -b --pretty false
```

And backend:

```zsh
cd /Users/miladarbabi/Codes/projects/SynchroFlow || exit 1
SKIP_DEPS=1 npm run build -w apps/backend
```

### Step 5 — Manual Smoke Test

Manually check:

```text
/orders/flow loads.
Order Flow tab is active.
Left nav shows Order Flow.
Blocked alert appears when blockedCount > 0.
Review blocked anchors to blocked review panel.
Release wave works with no selection.
Selected release sends exclusive: true.
Release success banner does not crash when pick_batch_id is null.
Skipped orders are shown if backend returns skipped_orders.
Legacy URLs redirect:
- /orders/blocked
- /orders/pool
- /fulfillment
```

---

## 11. Implementation Philosophy

The **Order Flow** implementation should stay strict:

```text
No fake state.
No guessed reasons.
No hidden backend mismatch.
No hardcoded colors.
No route dead ends.
No UI copy that implies a false operational model.
```

The final product should make the warehouse feel **controlled**, **calm**, and **operationally truthful**:

```text
Blocked work is visible.
Clean work is releasable.
Released work is trackable.
Skipped work is explained.
```

---

## 12. Constraint Re‑evaluation (BL‑01a)

**Constraints are only re‑evaluated when an order receives a domain event.**

An order that stops receiving events keeps whatever `block_type` the evaluator of the day wrote — permanently. The order‑pool query excludes on `is_active` regardless of `constraint_type` or `block_type`, so such an order is blocked forever with no supported path back.

Concrete case: the operational evaluator was rewritten on 2026-06-20 (`9e13b62f`) to derive blocks from unresolved `pick_exceptions`, and BL‑01b later made it inert entirely. Seven shop‑1 orders still carried `operational:sla_breach` — a `block_type` no current evaluator can produce — because no event had reached them since June.

### Tool

```text
npm run reevaluate:order-constraints -w apps/backend -- --shop-id=<n>
  dry-run by default
  --apply requires explicit --order-ids=<uuid,...> and --confirm=BL-01A
  there is no apply-all
```

Emits `orders/constraints_reevaluated`: a no‑op order‑entity event. The handler mutates nothing; `projectDomainEventCore` runs the standard age → constraints → risk → snapshot orchestration. Constraints are **never** cleared directly.

### What Re‑evaluation Does and Does Not Do

It asserts **nothing** about the outcome. A legitimate block is re‑asserted; a wrong block is replaced by the correct one. Production 2026-08-08: `16895470436722` traded a false `sla_breach` for a genuine `customer:incomplete_address` and stayed blocked — it did **not** become releasable. Active customer constraints went 6 → 7 as a result.

**Run this after any evaluator change.** Orders frozen before the change keep the old verdict otherwise.

### Production Run, 2026-08-08

```ts
events 571-577, projection cursor 577
operational:sla_breach   active 7 → 0 (32 resolved)
customer:incomplete_address active 6 → 7
inventory:oversell       active 7 unchanged
ready_for_release        1 → 3
```

Five of the seven were already batched, so they resolved a false block without entering the pool — batch membership excludes independently of constraints.

### Blocked Lifecycle Source‑of‑Truth and Reactivation Invariant — BL‑15 / BL‑16 family, 2026-08-08

`order_constraints` is the canonical answer to **whether and why an order is blocked**.

A row in `decisions` is enrichment for recommended/alternate actions. It must **never** be required in order to expose an existing blocker. Therefore:

```ts
active constraint + current decision
→ blocked; show constraint + decision enrichment

active constraint + decision = null
→ blocked; show constraint and any supported constraint‑derived resolution path

no active constraint
→ do not present the order as blocked merely because a stale decision exists
```

**BL‑15** corrected the decision endpoint so an order with active constraints but no current decision returns the constraint state rather than collapsing to a 404/no‑issue presentation.

**BL‑16** applies the same invariant to resolution UX. `customer:incomplete_address` exposes **Correct shipping address** from the active customer constraint itself, not from `recommended_action.type`. The address mutation is the supported correction path; the generic decision execution endpoint is **not** synthesized or used when no actionable decision exists.

### Constraint Lifecycle Identity

`orderConstraintProjection` uses deterministic stable IDs for a logical constraint scope:

**constraint:** `(order_id + constraint_type + target_id)`

**bridge constraint event:** `(order_id + constraint_type + target_id)`

A resolved logical constraint must therefore be reactivated by updating its existing stable row, **not** by attempting to insert that deterministic primary key again.

**BL‑16-UX‑BLK‑01** fixed the lifecycle accordingly:

```text
first activation
→ insert canonical row
→ insert bridge row
→ both active

re-evaluation while active
→ update same canonical row
→ update same bridge row
→ both remain active

resolution
→ canonical is_active=false + resolved_at
→ bridge is_active=false + resolved_at

later reactivation
→ update same deterministic canonical row
→ update same deterministic bridge row
→ resolved_at cleared
→ both active again
```

The canonical and bridge rows must transition together. A state where one is active and the other resolved is lifecycle drift.

### Local Regression Proof — Order #800003

**Controlled order:**

```text
external order: 800003
lasyncro_order_id: 9fdddd49-8d6b-fc1c-2bf2-c2e5a0563f4d
customer constraint id: f328ebe4-b745-5301-a439-cdcf8326ddff
customer bridge id: 665bb51b-a791-5eaa-8035-a42903de5ff7
```

The test repeatedly removed only `shipping_zip`, then emitted the supported `orders/constraints_reevaluated` event.

Before BL‑16‑UX‑BLK‑01, reactivation attempted to insert the already‑existing deterministic customer constraint ID and crashed the DB projection worker with PostgreSQL **23505** `order_constraints_pkey`.

**After the fix:**

- poisoned event 90 reprocessed successfully;
- canonical customer + inventory rows were both active;
- bridge customer + inventory rows were both active;
- each logical scope remained exactly one row in each table;
- no duplicate deterministic IDs were created;
- the projection worker remained running;
- later fresh re‑evaluations, including events 92 and 94, repeatedly reactivated the same rows successfully.

This is the regression requirement for any future constraint lifecycle change: **resolve → reactivate → resolve → reactivate** must remain idempotent and worker‑safe.

The existing playbook already states that BL‑01A re‑evaluation re‑runs normal evaluator/projection machinery rather than directly clearing constraints, so this lifecycle section extends that exact architecture rather than introducing another model.

---

## 13. Snapshot Metric Truth — BL‑18, 2026-08-08

**Defect:** `exception_orders` counted every row ever written to `order_constraint_events`. No `is_active` filter, no per‑order de‑duplication. Monotonic growth; never fell on resolution.

**Production evidence, shop 1, snapshot 2026-08-08 14:02:47:**

```text
exception_orders    56
constrained_orders   9
distinct blocked orders (canonical)  9
bridge rows is_active=f              35 of 56
```

Series: `48 → 49 → 49 → 55 → 56` while `constrained_orders` moved `15 → 16 → 15 → 15 → 9`.

Surfaced as "56 orders need intervention" via `createOperationalExceptionSignal:47`, on the same screen whose header read 9 blocked (BL‑06a).

**Fix:** `misc.metrics.ts:63` now counts at **ORDER** level from canonical `order_constraints` via `whereExists`, matching `constraint.metrics.ts:112`.

**Local proof:** `exception_orders 4 → 3`, equal to `constrained_orders` and to order‑level truth. `GET /api/v1/modules/order-nexus/ft2` returned `exception_orders: 3, constrained_orders: 3`.

**RULE — any metric counting ORDERS:**

```text
count FROM orders, whereExists active order_constraints
never count constraint rows directly
never read order_constraint_events (deprecated bridge; its is_active drifts from canonical — BL-17, 21 rows in production)
```

Consistent with `overview-live-map-playbook` §"One fact source → one signal everywhere".

**Open:** `exception_orders` now equals `constrained_orders` by construction (BL‑19 — product call on whether to retire the field).

---

## 14. Blocked Card Vocabulary — BL‑02a, 2026-08-09

**Defect A — subtitle read from `decisions`.**  
`OrderFlowPage.tsx:848` rendered `recommended_action.type` with a hardcoded `'Manual review required'` fallback. Production has `decision=null` on every blocked order, so all 9 cards displayed a workflow that does not exist. When a decision did exist it leaked a raw system identifier through `.replace(/_/g, ' ')` — operators would read `'resolve customer block'`, violating `CONSTRAINT_LABELS`' stated contract that system vocabulary is never exposed.

Third instance of the BL‑15 / BL‑16 pattern: a surface deriving blocked truth from `decisions` instead of `order_constraints`.

**Defect B — `blockedBucket` chip rendered 'Overdue'.**  
`useConstrainedOrders.ts:17` records that `'Overdue'` was removed from the constraint label because it collided with this CPT time indicator. The collision was resolved on one side only. The chip duplicated the age shown beside it and read as a blocker reason. Removed; age alone is the honest time signal.

**Fix:** `getBlockerReason(order)` in `useConstrainedOrders.ts` derives an operator sentence from canonical `constraint_type` + `block_type` only.

```text
customer / incomplete_address  -> Shipping address incomplete
customer / other               -> Customer details need attention
inventory / *                  -> Not enough stock to fulfill
operational / *                -> Pick exception on the floor
unmapped                       -> Needs attention
```

Card layout is now 2×2: identity + reason left, value + age right.

**RULE — any operator‑facing blocked‑order text:**

```text
derive from order_constraints (constraint_type, block_type)
never from decisions / recommended_action
never expose a raw system identifier
no hardcoded fallback that asserts a workflow
```

**Open:**

- **BL‑02a‑FU‑01** — revisit inventory wording after BLOCKED‑INV‑01 settles: `available_quantity` / `reserved_quantity` / `on_hand_quantity`. `'Not enough stock to fulfill'` is deliberately safe; `'Oversold'` is not yet earned.
- **BL‑02a‑FU‑02** — `blockedBucket` (`OrderFlowPage.tsx:331`) is now dead, and its `liveCapacityQuery` dependency may be too. Removal is a dead‑code change, deliberately not mixed into this fix.

## 15. Blocked count vocabulary — BL-06a, 2026-08-09

Two surfaces on Order Flow both said "Blocked" while counting
different sets:

  header (:568)   blockedCount = blockedOrders.length
                  ALL constrained orders

  pool chip (:957) poolSummary.blocked_count
                  constrained AND unbatched
                  wms.controller.ts:2540-2543 —
                    pbo.lasyncro_order_id IS NULL
                    AND active_constraints.lasyncro_order_id IS NOT NULL

Production showed 9 and 8. Both counts were correct; only the labels
collided.

All four pool chips (Ready / In batch / Blocked / Fulfilled) share the
pbo.lasyncro_order_id IS NULL predicate, so they partition UNBATCHED
orders. Making the chip count all 9 would break that partition — an
order would appear under both "In batch" and "Blocked".

Fix: chip label is now "Blocked · unbatched". Header keeps the plain
"N blocked" as the honest headline for the whole constrained set.

Also fixed: poolBlockedCount fell back to blockedCount when poolSummary
was absent, displaying an all-constrained figure under a label promising
an unbatched filter. Now falls back to 0, matching its sibling counts.

RULE — when two surfaces show counts of the same noun, either the
predicates match or the labels must differ. A shared label across
different predicates is a defect even when both numbers are right.

## 16. Exception orders vs constrained orders — BL-19, 2026-08-09


Two metrics, two lifecycle stages, deliberately disjoint:

  constrained_orders   PRE-release. Orders held in the Blocked column by
                       an active order_constraints row. Never released.
                       constraint.metrics.ts:112

  exception_orders     POST-release. Orders with an UNRESOLVED line-item
                       exception raised on the floor, from release until
                       shipped. misc.metrics.ts
                       An order cannot hold both.

BL-18 fixed this metric's arithmetic and left its semantics wrong: it
counted the PRE-release side, duplicating constrained_orders. Two
metrics equal by construction was the signal one measured the wrong set.

Source is pick_exceptions, post-release by construction — BL-01b records
that pick_exception_stage is ('pick','pack'), reachable only after
/wms/batch/release then /claim.

THE JOIN TRAP — read before touching this query.
pick_exceptions is line-item scoped (lasyncro_line_item_id) but points at
a BATCH (pick_batch_id). Resolving the order through pick_batch_orders
fans out to every order in the batch. Measured: one unresolved exception
on one line item of one order returned 3, because the batch held 3
orders. countDistinct does not save you — the distinct order ids are
real, they are simply the wrong ones.

The order MUST come from order_line_items. pick_batches may be joined for
the cancelled check only, never for order resolution.

Exclusions: resolved=false; batch status <> 'cancelled'; order not
shipped per order_warehouse_status.status (written by the Sendcloud and
Shippo tracking handlers on carrier pickup). partially_shipped still
counts — part of the order is still on the floor. LEFT JOIN because the
status row may not exist yet.

Verified end to end through real endpoints, not fixtures:
  raise  POST /wms/batch/:batchId/exception     -> 0 then 1
  resolve POST /wms/problem-center/pick-exceptions/:id/resolve -> 1 then 0
constrained_orders held at 3 throughout.

RULE: when a metric's source table has a finer grain than the metric,
resolve the entity through the grain-matching join. Test that it counts
UP, not only that it returns a plausible number — a 0-to-0 verification
would have shipped the batch-fanout bug.

---

## 17. Order pool panel — POOL-VIS-01, 2026-08-15

Three changes to the Order Pool column header and count row.

### Defect A — counts styled as filters, directly above real filters

The four pool counts rendered as bordered pills (`999px`, `0.5px` border,
`var(--bg-3)`) with no `onClick`. Immediately beneath them sit the OF-02
`Priority` / `SLA breached` chips, which *are* toggles — `onClick`,
`active` state, accent colouring, dot indicator.

Two visually similar pill rows stacked, one interactive and one not. The
counts were not merely ambiguous in isolation; they were ambiguous against
a working control one line below.

Fix: the counts render as a plain strip — label in `--ink-4`, value in
`--ink-2`, no border, no radius, no background. Counts state facts; chips
filter. Making them real filters was considered and rejected: the panel
answers "what can I release right now", and the row source shows eligible
orders only, so filtering to `Fulfilled` would empty the panel. That is a
separate feature, not a styling fix.

### Defect B — `In batch` grouped with counts it does not partition

§15 established that the pool chips share `pbo.lasyncro_order_id IS NULL`
and therefore partition unbatched orders. `in_batch_order_count` is
deliberately exempt from that predicate (`wms.controller.ts:3143`) — it
counts the complement. Rendered in the same row with identical styling, it
implied a sum that does not exist.

Removed from the group. It belongs beside `active_batch_count` in the
fulfillment context; that placement is not made here.

### Defect C — `Ready` stated twice, no money on the pool

The panel header read `Order pool · {readyCount} ready` and the first chip
read `Ready {readyCount}` — the same number two lines apart, the headline
figure demoted into a strip of secondary counts. The `Ready` chip is
removed.

Separately, the page header states `{fmt$(heldRevenue)} held` for blocked
orders, so a merchant could see what was stuck in money terms but nothing
about what was ready to ship. The pool header now carries
`{fmt$(releasableRevenue)} releasable`, summed over `poolOrders` via
`total_price` (`useOrderPool.ts:27`) — a different field name from
`blockedOrders.revenue`, same meaning.

Header now reads:

```text
Order pool · 3 ready · $1,234.56 releasable
paid · stock reserved
Blocked · unbatched 12   Fulfilled 0
```

### Verified

Local shop 1, empty pool: `ORDER POOL · 0 READY · $0.00 RELEASABLE`, count
strip renders `Blocked · unbatched 3` / `Fulfilled 0` as plain text, OF-02
chips unchanged and still visibly interactive. The releasable sum is
unproven against a populated pool — local `eligible_order_count` is 0.

The empty state deliberately still prints `$0.00 releasable` rather than
omitting the clause: a header whose shape is stable across states is easier
to scan than one that grows and shrinks.

## DC-01 / DC-01b — blocked revenue was double-counted

`constraint.metrics.ts` computed `blockedRevenueTotal` by adding the three
category figures:

    revenueBlockedInventory + revenueBlockedCustomer + revenueBlockedOperational

Those categories are **overlapping sets by construction**. An order blocked on
both stock and address appears in inventory *and* customer, so the sum
double-counts every multi-blocked order. On shop 15 that produced $22,195.95
against a true $16,172.20 — a 37% overstate on the figure a merchant reads as
"revenue at stake". Six of thirteen blocked orders carried a second blocker;
their $6,023.75 was exactly the gap.

The same file already applied the correct discipline to `constrainedOrders`
("derive at ORDER level — prevents duplication from multiple constraint rows
per order"). It was never applied to the money. That is why every surface
agreed on the count of 13 and disagreed on the dollars.

**DC-01** — the total is now derived at order level via `whereExists`, mirroring
`constrainedOrders`. Basis is `o.total_price`: a blocked order cannot ship, so
the whole order's revenue is held. This deliberately differs from
`revenueBlockedInventory`'s variant-scoped `net_revenue`, and makes the total
agree with Order Flow's per-order sum, which was already correct.

**DC-01b** — the customer and operational queries summed `o.total_price` across
a *join* to `order_constraints`, emitting one row per constraint. An order with
two active constraints of the same type had its revenue summed twice. Both now
use `whereExists`.

The three category figures are unchanged and remain individually correct — they
answer "how much revenue does this cause touch", which legitimately overlaps.
Only their sum was invalid.

Verified on local shop 1 with a three-order fixture (customer-only,
inventory-only, and one carrying two customer constraints plus an inventory
constraint), run through the real dispatcher path
`computeShopOperationalSnapshot('1')`:

| Field | Broken | Fixed |
|---|---|---|
| `blocked_revenue` | 9179.85 | **7179.85** |
| `revenue_blocked_customer` | 9000.00 | **5000.00** |
| `revenue_blocked_inventory` | 179.85 | 179.85 |
| `constrained_orders` | 6 | 6 |

Fixture removed; snapshot returned to the 179.85 / 0.00 / 3 baseline.

**No backfill.** Historical snapshot rows keep the inflated figure. `is_active`
is current-state, not time-travelled, so past rows cannot be recomputed without
event replay — and rewriting a dated series would change what the merchant saw
on days they made decisions. Snapshots from before this fix are known-bad for
`blocked_revenue` only.

Related: **PROJ-GUARD-DEL-01** was found during cleanup — all five
`enforce_projection_writer_*` trigger functions `RETURN NEW` unconditionally, so
DELETE is a silent no-op on five projection tables. Five orphaned fixture rows
remain in local `order_constraints` as a result; they are invisible to every
metric (all join through `orders`) and clear on the next `db:reset`.

## DC-02a / DC-02b — cumulative figures labelled as daily

The Orders module rendered `orders.fulfilled` as "N shipped today" in two places
(left-panel footer and the Today's pulse footerNote), and `revenue.earned` as
"$X collected" in the same today-framed sentence.

Neither figure is daily:

- `fulfilledOrders` (`queue.metrics.ts:173`) is bounded only by
  `order_created_at <= snapshotCutoff` — an upper bound. Cumulative.
- `realizedRevenue` (`revenue.metrics.ts:27`) sums `net_revenue` with the same
  upper bound and no day scoping. Cumulative.

Shop 15 therefore claimed 23 shipped today while Outbound's newest shipment was
20 Jun 2026 and Shipping Health read "Value shipped this week $0.00". Overview
showed "Revenue today $0" beside "Collected today $54,859". The contradicting
surfaces were the truthful ones.

Both numbers were always correct. Only the labels were wrong, so the fix is a
relabel: "N fulfilled to date · $X collected to date".

A correctly day-scoped count already exists —
`wms.controller.ts:4664`, `COUNT(*) FILTER (WHERE ows.shipped_at::date =
CURRENT_DATE)` — feeding Overview's map and WMS Analytics. It is not plumbed to
this module.

**DC-02c (open)** — restore genuine daily framing to Today's pulse. `shipped_today`
is available; `realized_revenue` has no day-scoped equivalent in the snapshot and
one would need building. That is a design question, not plumbing.

## DC-03 — elapsed time rendered as SLA breach

The Orders pulse headline, its Breached row, and the stage bar all rendered
`aging_72h_plus` under the word "Breached". That metric is:

    COUNT(*) FILTER (WHERE oas.age_since_creation_seconds >= 259200)

72 hours since order creation, over unfulfilled orders. No reference to
`promised_ship_by`. An order can be four days old and comfortably within its
promise, or breach in six hours — the two sets overlap and neither contains the
other. Shop 15: 15 aging vs 13 actually breached.

The genuine SLA count was already on the page: `criticalOrders`, filtered on
`is_shipping_sla_breached` (projected in `orderAgeProjection.ts:142`). The
"Critical — act today" section used it and correctly showed 13, as did
Overview's "13 orders past shipping SLA".

The card also contradicted itself: the headline showed the aging figure while
its own "N still need priority" subtext counted within `criticalOrders`.

This conflation was already identified and fixed once in the same file — the
2026-07-01 comment on `constraintLabel` documents Watch rows displaying "SLA
breach" on orders where `isShippingSlaBreached: false`, corrected to take "the
real breach flag so it can tell the two apart honestly." That fix was never
propagated six lines down to `aging72`.

**Resolution, split by what each surface is for:**

- Pulse headline and Breached row now use `slaBreachedCount`
  (`criticalOrders.length`) — "Today's pulse — N breached" is meant to be the
  SLA signal, and its subtext already counted that way.
- Stage bar keeps the aging bucket but is relabelled **"Aging 3d+"** — an age
  band belongs beside Ready/Picking/Blocked as a pipeline state. The `key`
  remains `breached`; renaming it requires a consumer sweep.

**DC-09 (open, P3)** — `stageData.reduce` at the same site sums overlapping
stage counts. An order that is both Blocked and 3d+ aged is counted twice.
Whatever `accountedFor` gates may be wrong. Same family as DC-01.

## DC-04 — "Ready" named two different pipeline positions

The Orders pulse showed "Ready 13"; Order Flow showed "3 ready to release".
Both correct, measuring different things:

- `queue_ready_to_ship` (13) — paid, not fulfilled, not partially fulfilled, no
  active constraint. Every unblocked order regardless of batch or pick state:
  pool, batched, picking, packed alike.
- `eligible_order_count` (3) — the release pool: eligible **and not yet
  batched**. A subset of the 13.

**Vocabulary settled:**

- **Order pool** is the named place releasable orders collect. The panel header
  and the isometric map block already called it that; the Order Flow page header
  was the only surface saying "ready to release". Now reads "N in order pool".
- **Fulfillable** is the pulse label for `queue_ready_to_ship` — it states the
  predicate (nothing is in this order's way) without implying a pipeline stage.
- **Unblocked** is deliberately NOT used for either. It means orders that had a
  block and had it removed — a transition, not a state. Nothing currently
  computes it; if that metric is ever wanted, the word is reserved.

The stage bar keeps `key: 'ready'`; renaming requires a consumer sweep.

**DC-10 (open, P3)** — blocked revenue renders as `$179.85` on Order Flow and
`$180` on Overview/Orders. Same value, different formatter.
