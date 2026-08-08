# LaSyncro Order Flow Implementation Playbook

## 1. Purpose

This playbook documents the design, implementation progress, product logic, technical pitfalls, and current state of the new `Order Flow` surface in LaSyncro.

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

The purpose is not to merge all operational states into one flat table. The purpose is to give warehouse admins and owners one clear place to understand and act on the order lifecycle:

```text
Blocked → Release Pool → Fulfillment
```

The core principle is:

```text
One surface, separate operational states.
```

Blocked orders remain blocked. Clean orders enter the release pool. Released batches enter fulfillment.

---

## 2. Product fundamentals

### 2.1 Orders must pass through a clean operational gate

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

### 2.2 Blocked orders are not a global stop sign

Blocked orders should not block the whole operation.

A blocked order means:

```text
This specific order cannot move forward until its issue is resolved.
```

It does not mean:

```text
No other orders can be released.
```

Therefore, the `Order Flow` UX must not auto-focus the user into blocked orders every time blocked count is greater than zero. In a real warehouse, there will often be some blocked orders.

### 2.3 Equal visibility, not frequency-led (revised 2026-06-25)

Original principle (kept for history): release-pool work is the most frequent daily action, so blocked orders should stay behind a compact alert + panel rather than occupy equal space.

That principle is superseded. The actual shipped target gives Blocked, Pool, and Fulfillment equal persistent visual weight as three side-by-side columns ("Blocked → Pool → Fulfillment, read left to right"). Severity within each column is now signalled by content (reason tags, age, stalled flags), not by whether the column itself is visible at all.

### 2.4 Truth over optimistic UX

If a user selected orders and some are not released, the UI must say exactly what happened.

Bad UX:

```text
Release failed.
```

Better UX:

```text
#1048 was not released because it is now Out of Stock.
```

The frontend should not guess the reason. The backend must return the reason.

---

## 3. Target UX model

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

These legacy pages/routes can continue to exist internally for compatibility, but they should no longer be primary user-facing navigation once `Order Flow` is active.

### 3.1 Order Flow layout (revised 2026-06-25)

The target page structure is a 3-column board, read left to right:

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

### 3.3 Blocked orders column

Entry criteria: any order with an active row in `order_constraints`.

Card per order shows:

```text
order id
value
reason tag (constraint_type, operator-facing label)
recommended_action.type (or "Manual review required")
age since creation
```

Operator-facing labels:

```text
operational → Overdue
inventory → Out of Stock
customer → Address Issue
```

System words should not leak to the operator when a more useful label exists.

No "Phantom" category exists. `constraint_type` is a hard DB enum — inventory | customer | operational only (`order_constraint_events` migration). Any UI/design reference to a 4th "Phantom" category was based on the original target mockup, not actual data — confirmed false 2026-06-25.

Reason-specific resolution is supported only where a real canonical correction path exists.

For `customer:incomplete_address`, the operator can open Order Detail and use **Correct shipping address**. The address correction writes through `PATCH /api/v1/orders/:orderId/shipping-address`; the active customer constraint remains authoritative until normal reconciliation re-evaluates and resolves it. The UI must never clear the blocker optimistically.

Inventory and other blocker workflows remain separate and must not be inferred from the customer-address path.

### 3.4 Order pool column

Entry criteria (unchanged): constraint-free, unbatched, pending or processing, inside the current shop.

Table:

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

Footer:

```text
live selection summary (N selected · only selected orders will be released)
line items / units to pick, against max_batch_line_items
operator assignment
Release wave to floor
```

Important copy: "Pickers see it on their mobile instantly."

Release model (clarified 2026-06-25): exactly ONE batch per release action — either the full eligible pool (greedy-filled to `max_batch_line_items`), explicitly selected orders only (exclusive), or selected orders with the remaining batch capacity greedy-filled from the rest of the pool. There is no per-zone batching and no multi-batch release in a single action — any UI implying "Release N batches" in one click is incorrect.

### 3.5 Fulfillment column

Entry criteria: batches returned by `GET /api/v1/wms/batches` (excludes `pack_complete` and `cancelled` server-side).

Card per batch shows:

```text
batch id
status (Picking / Picked / Packing / Packed)
4-stage stepper
time in current stage
line/unit counts
picker or packer name, once assigned
```

Read-only. No advance-stage actions on this column: claim, pick-complete, and pack-complete are gated by operator ownership (`picked_by`/`packed_by` must match the caller) and, for pick-complete, a scan-completion guard — none of which a manager-facing screen can satisfy. Those transitions belong to the picker/packer's own flow, not Order Flow.

"Shipped" is intentionally not a stage here: per `POST /api/v1/wms/batch/:batchId/ship`, shipment is confirmed per-order, not as a pick-batch status transition. A shipped order leaves Fulfillment entirely and is tracked in Outbound.

Stalled-batch highlighting: deferred pending integration with the existing `alerts` table (`alert_type: 'wms_operator_idle'`), not a frontend-computed threshold — `shop_wms_settings.idle_alert_threshold_minutes` is already the source of truth server-side and should not be duplicated.

---

## 4. Theme and styling rules

All new UX must be theme-aware and compatible with both light and dark modes.

### 4.1 Allowed styling source

Use existing CSS variables and theme surfaces only.

Preferred variables:

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

Do not introduce hardcoded visual colors:

```text
rgba(...)
#FFFFFF
#000000
#FF6B2B
```

Exception:

```text
# in rendered order numbers such as #1048 is not a color and is acceptable.
```

### 4.3 Verification command

Use:

```zsh
grep -n "rgba(\|#[A-Fa-f0-9]" apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx
```

Expected result:

```text
No hardcoded visual colors.
```

If this grep catches an order-number template such as `#${order.external_order_id}`, that is acceptable because it is not a color.

---

## 5. Files touched so far

### 5.1 New primary page

```text
apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx
```

Purpose:

```text
Unified Orders working surface.
Combines blocked review, release pool, wave builder, and fulfillment status.
```

### 5.2 Shared release-pool hook

```text
apps/frontend/src/pages/wms/useOrderPool.ts
```

Purpose:

```text
Shared data/actions for:
- ReleaseQueuePage
- OrdersFT2Page priority action
- OrderFlowPage
```

Current responsibilities:

```text
GET /api/v1/wms/order-pool
POST /api/v1/wms/orders/:orderId/priority
POST /api/v1/wms/batch/release
```

### 5.3 Constrained orders hook

```text
apps/frontend/src/pages/orders/useConstrainedOrders.ts
```

Purpose:

```text
Fetch blocked/constrained orders from canonical backend source.
Expose operator-facing constraint labels.
```

Important exported helpers:

```ts
getConstraintLabel()
getAgeLabel()
useConstrainedOrders()
```

### 5.4 Route host

```text
apps/frontend/src/lifecycle/LifecycleRouteHost.tsx
```

Changes made:

```text
/orders/flow route added.
Legacy split routes redirected to /orders/flow:
- /orders/blocked
- /orders/pool
- /fulfillment/*
Unused lazy imports removed.
```

### 5.5 Orders module tabs

```text
apps/frontend/src/pages/ft2-pages/ordersModuleTabs.ts
```

Visible tabs updated to:

```text
Overview
Order Flow
Outbound
Inbound
Returns
```

### 5.6 Runtime nav

```text
apps/frontend/src/runtime/navBootstrap.ts
```

Left nav Orders children updated to:

```text
Overview
Order Flow
Outbound
Inbound
Returns
```

### 5.7 Backend pick batch service

```text
apps/backend/src/services/wms/pickBatch.service.ts
```

Changes made:

```text
ReleaseBatchResult extended.
SkippedReleaseOrder added.
Exclusive selected-release behavior protected.
Backend now has a response channel for skipped selected orders.
```

### 5.8 CPT risk matrix + cross-linking (v1)

File: apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx

Shipped:

- bucketByCpt(createdAtIso, hoursToCpt) → 'overdue' | 'today' | 'ahead' (file-local, not exported — react-refresh).
- cptMatrix useMemo: pool + blocked grouped into { overdue, today, ahead } × { blocked, pool, picking, packing, valueAtRisk }.
- CPT cutoff from useLiveCapacity (60s), cpt_local/hours_to_cpt.
- Matrix JSX: stage rows × bucket columns, danger ring on overdue·blocked, $ at risk footer, theme tokens only.
- Cross-linking: cptFilter state; click a blocked/pool cell → visibleBlocked/visiblePool filter to that cell; active-cell ring; clear chip in header. Release/selection still read unfiltered poolOrders.

Data caveats:

- x-axis buckets on order_created_at (ISSUE-10: promised_ship_by defined but unwritten/all-NULL).
- picking/packing parked in 'today' (no per-batch deadline until ISSUE-4).

Cadence: batches 10s on this page (per-call override); blocked/pool via existing hooks.

Per-carrier CPT columns + promised_ship_by writer (GitHub #1017) still deferred. Iso twin is NOT deferred — see §5.9, status corrected 2026-06-25: shipped then removed, not currently present.

### 5.9 Isometric floor twin (REMOVED — see status note)

**Status corrected 2026-06-25 (code audit):** shipped in commit `670977ed`
("v1 iso twin shipped and documented"), then removed when the full page
rewrite landed in `27999b71` ("orders flow module rewired fully"). This
section was never updated after the removal, which is why §7 separately
(and correctly) lists it under "Not done yet" — both statements were true
at different points in time, just never reconciled until now.

The `IsometricCanvas` component itself was NOT deleted — it's still live in
`@lasyncro/shared/ui` and actively used by `modules/floor-planning`
(`FloorPlanningModuleFT2.tsx`, `CanvasEditor.tsx`). Re-adding it to Order
Flow would be a re-wire against an existing, working component, not a
from-scratch build.

Original v1 documentation preserved below for reference:

File: apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx

Model: one authored map, many stories. The warehouse map is built once in
Floor Planning (Setup/Canvas) and stored in warehouse_locations. Every surface
renders the SAME IsometricCanvas; only the overlaid data/story changes. Order
Flow narrates the order-fulfillment story on it.

Zone source:

- useFloorPlanning() → data.zones (WarehouseZone[]), from GET /api/v1/floor-planning/layout
  (controller returns { zones, product_barcodes }). Canonical map — same hook the
  Floor Planning Setup surface uses. NOT useWarehouseGrid (that returns {locations }).

Batch → zone (ISSUE-4, resolved frontend-only):

- Batches carry no zone column. Derived client-side: usePickBatchLineItems(batchId)
  → line_items[].location_code → Set → passed as IsometricCanvas filteredCodes to
  light active-pick zones. No backend change.

v1 scope:

- Single focused batch only: first batch with status picking|packing. filteredCodes
  lit from its line items. filteredCodes omitted (undefined) when none → full floor shown.
- Canvas from @lasyncro/shared/ui, token-sourced (--zone-*).
- Guards: zones.length === 0 → "build it in Floor Planning"; no active batch → label only.

Deferred (as of original v1 ship — not re-verified against current code):

- ISSUE-4d — light ALL active batches at once (usePickBatchLineItems is single-batchId;
  hooks can't loop). Needs aggregate useActiveBatchZones hook. v1+.
- Shared CPT-urgency tint on zones (match matrix palette) — needs new canvas overlay prop.
- Matrix-cell ↔ zone click-sync — extends cross-linking to the iso.

---

## 6. Backend release logic

### 6.1 Normal release

When the user releases without selecting specific orders:

```text
Backend releases a normal batch from eligible orders.
Priority-flagged orders come first.
Remaining orders fill oldest-first.
Batch respects max_batch_line_items.
```

### 6.2 Selected release

When the user selects specific orders in `Order Flow`:

```text
Frontend sends selected IDs as priority_order_ids.
Frontend also sends exclusive: true.
Backend validates selected IDs against the eligible pool.
Only valid selected IDs should be released.
No greedy fill should happen in exclusive mode.
```

### 6.3 Why backend revalidation is required

Even if the release pool was clean when the frontend loaded, the order state can change before the user clicks release.

Examples:

```text
Order becomes blocked.
Order is already batched somewhere else.
Order fulfillment status changes.
Order disappears from the eligible pool.
```

The backend must revalidate at click-time.

### 6.4 Skipped-order feedback

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

### 6.5 Important backend behavior

The backend should return skipped-order explanations before generic `null` returns where possible.

Correct behavior:

```text
Exclusive selected release, selected orders invalid → return skipped_orders.
Normal release, no eligible orders → return null.
```

---

## 7. Current implementation status

### Done

```text
Created OrderFlowPage.
Added /orders/flow route.
Updated Orders module tab bar.
Updated runtime left nav.
Redirected /orders/blocked to /orders/flow.
Redirected /orders/pool to /orders/flow.
Redirected /fulfillment/* to /orders/flow.
Removed unused legacy lazy imports from route host.
Created shared useOrderPool hook.
Updated ReleaseQueuePage to use shared hook.
Updated OrdersFT2Page to use shared useSetPriority.
Added blocked alert strip.
Added compact blocked review panel.
Added release-pool table.
Added next wave builder.
Added fulfillment live strip.
Made selected release exclusive.
Added backend skipped-order response contract.
Updated frontend ReleaseBatchResult contract.
Started frontend skipped-order banner wiring.
Cleaned backend indentation around skipped-order block (pickBatch.service.ts:132-208).
Fixed hardcoded #fff on release button → theme.palette.common.white (OrderFlowPage.tsx:671).
Fixed stale/misleading code comments (OrderFlowPage.tsx, useOrderPool.ts) and a broken indentation block (blockedByBucket/blockedBannerSummary).
Added blockedByReason grouping by constraint_type, surfaced in the blocked banner.
Added persistent reason-tagged Blocked orders column (target-IA Phase 1) — additive, alongside existing banner/Drawer pending Phase 4 cleanup.
Added consolidated Order pool column (target-IA Phase 2) — additive, alongside existing Next-Wave panel/pool table pending Phase 4 cleanup.
Added compact Fulfillment batch cards (target-IA Phase 3a) — read-only monitoring (status, 4-stage stepper, time-in-stage); no advance-stage actions, see §3.5.
Reconciled this playbook's isometric-twin contradiction and rewrote §2.3/§3 to match the actual 3-column target.
```

### In progress

```text
Verify releaseSuccess banner guard around nullable batchId.
Wire skipped_orders fully into frontend release feedback.
Run targeted TypeScript build after frontend/backend contract changes.
```

### Not done yet

```text
Blocked-order resolution actions inside the new Blocked orders column (reason-specific workflows — e.g. retry label, verify address — explicitly deferred, not yet scoped).
Deep-link panel state such as /orders/flow?panel=blocked. — OBSOLETE: referred to the old Drawer pattern, which the target architecture doesn't use. No replacement currently planned.
Phase 3b — stalled-batch highlighting via the existing alerts table (alert_type: 'wms_operator_idle'); needs an alerts-fetching-hook audit first. Do not compute a separate frontend threshold — shop_wms_settings.idle_alert_threshold_minutes is the single source of truth server-side.
Phase 4 — replace the old 2-column shell (Next-Wave panel + CPT-risk matrix + old pool table + blocked banner/Drawer) with the new 3-column board as the only UI; remove the now-dead code. Old and new UI currently coexist on the page side-by-side — this is verification scaffolding, not the final state.
Permission-aware release action UI.
Operator role UX check.
Final removal or archival of old split pages.
Automated tests for exclusive selected release.

```

---

## 8. Current known pitfalls

### 8.1 Nullable pick_batch_id

Backend can now return:

```ts
pick_batch_id: null
```

This happens when no batch is created, but skipped-order information exists.

Frontend must never call:

```ts
releaseSuccess.batchId.slice(...)
```

unless guarded by:

```tsx
releaseSuccess.batchId && (...)
```

### 8.2 Old route links

Because old split routes now redirect to `/orders/flow`, new UI should not link to:

```text
/orders/blocked
/orders/pool
/fulfillment
```

Use local anchors, local panels, or future query params instead.

### 8.3 `replaceAll` TypeScript target issue

Do not use:

```ts
string.replaceAll(...)
```

Use:

```ts
string.replace(/_/g, ' ')
```

Reason:

```text
Current TypeScript lib target does not support replaceAll.
```

### 8.4 Theme safety

Do not introduce hardcoded colors.

Bad:

```ts
bgcolor: 'rgba(229,72,77,0.07)'
```

Good:

```ts
bgcolor: 'var(--accent-ghost)'
border: '1px solid var(--accent-border)'
```

### 8.5 Pool must stay clean

Do not design UX as if blocked orders normally live in the release pool.

Correct mental model:

```text
Blocked orders are reviewed beside the release pool.
They do not belong inside the release pool.
```

### 8.6 Backend truth first

Frontend should not guess why an order was skipped.

Bad:

```text
Probably blocked.
```

Good:

```text
Backend says reason = blocked, label = Out of Stock.
```

---

## 9. Current user-facing release feedback target

When all selected orders release:

```text
3 orders released · Batch 8F3A21B0 is now active in fulfillment.
```

When some selected orders release and some are skipped:

```text
2 orders released · Batch 8F3A21B0 is now active in fulfillment.
1 order not released · #1048 · Out of Stock
```

When no selected orders release:

```text
2 orders not released · #1048 · Out of Stock · #1051 · Already in a pick batch
```

When no batch is created and no skipped-order data exists:

```text
No orders were released. The release pool may have changed. Refresh and try again.
```

---

## 10. Next immediate steps

### Step 1 — Verify the release banner block

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

### Step 2 — Clean backend formatting

The backend skipped-order block currently works logically, but indentation around the newly inserted section is messy.

Clean:

```text
apps/backend/src/services/wms/pickBatch.service.ts
```

around lines roughly:

```text
121–208
```

Do not change behavior while cleaning formatting.

### Step 3 — Finish skipped-order frontend banner

Make sure `OrderFlowPage` displays:

```text
released count
batch ID only when non-null
skipped order count
first 3 skipped order labels
+N more
```

### Step 4 — Run targeted builds

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

### Step 5 — Manual smoke test

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

## 11. Implementation philosophy

The `Order Flow` implementation should stay strict:

```text
No fake state.
No guessed reasons.
No hidden backend mismatch.
No hardcoded colors.
No route dead ends.
No UI copy that implies a false operational model.
```

The final product should make the warehouse feel controlled, calm, and operationally truthful:

```text
Blocked work is visible.
Clean work is releasable.
Released work is trackable.
Skipped work is explained.
```

---

## 12. Constraint re-evaluation (BL-01a)

**Constraints are only re-evaluated when an order receives a domain event.**

An order that stops receiving events keeps whatever `block_type` the evaluator
of the day wrote — permanently. The order-pool query excludes on `is_active`
regardless of `constraint_type` or `block_type`, so such an order is blocked
forever with no supported path back.

Concrete case: the operational evaluator was rewritten on 2026-06-20
(`9e13b62f`) to derive blocks from unresolved `pick_exceptions`, and BL-01b
later made it inert entirely. Seven shop-1 orders still carried
`operational:sla_breach` — a `block_type` no current evaluator can produce —
because no event had reached them since June.

### Tool

```text
npm run reevaluate:order-constraints -w apps/backend -- --shop-id=<n>
  dry-run by default
  --apply requires explicit --order-ids=<uuid,...> and --confirm=BL-01A
  there is no apply-all
```

Emits `orders/constraints_reevaluated`: a no-op order-entity event. The handler
mutates nothing; `projectDomainEventCore` runs the standard
age → constraints → risk → snapshot orchestration. Constraints are never
cleared directly.

### What re-evaluation does and does not do

It asserts **nothing** about the outcome. A legitimate block is re-asserted; a
wrong block is replaced by the correct one. Production 2026-08-08:
`16895470436722` traded a false `sla_breach` for a genuine
`customer:incomplete_address` and stayed blocked — it did not become
releasable. Active customer constraints went 6 → 7 as a result.

**Run this after any evaluator change.** Orders frozen before the change keep
the old verdict otherwise.

### Production run, 2026-08-08

```text
events 571-577, projection cursor 577
operational:sla_breach   active 7 → 0 (32 resolved)
customer:incomplete_address active 6 → 7
inventory:oversell       active 7 unchanged
ready_for_release        1 → 3
```

Five of the seven were already batched, so they resolved a false block without
entering the pool — batch membership excludes independently of constraints.

### Blocked lifecycle source-of-truth and reactivation invariant — BL-15 / BL-16 family, 2026-08-08

`order_constraints` is the canonical answer to **whether and why an order is blocked**.

A row in `decisions` is enrichment for recommended/alternate actions. It must never be required in order to expose an existing blocker. Therefore:

```text
active constraint + current decision
→ blocked; show constraint + decision enrichment

active constraint + decision = null
→ blocked; show constraint and any supported constraint-derived resolution path

no active constraint
→ do not present the order as blocked merely because a stale decision exists

BL-15 corrected the decision endpoint so an order with active constraints but no current decision returns the constraint state rather than collapsing to a 404/no-issue presentation.

BL-16 applies the same invariant to resolution UX. customer:incomplete_address exposes Correct shipping address from the active customer constraint itself, not from recommended_action.type. The address mutation is the supported correction path; the generic decision execution endpoint is not synthesized or used when no actionable decision exists.

Constraint lifecycle identity

orderConstraintProjection uses deterministic stable IDs for a logical constraint scope:

constraint:
(order_id + constraint_type + target_id)

bridge constraint event:
(order_id + constraint_type + target_id)

A resolved logical constraint must therefore be reactivated by updating its existing stable row, not by attempting to insert that deterministic primary key again.

BL-16-UX-BLK-01 fixed the lifecycle accordingly:

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

The canonical and bridge rows must transition together. A state where one is active and the other resolved is lifecycle drift.

Local regression proof — order #800003

Controlled order:

external order: 800003
lasyncro_order_id: 9fdddd49-8d6b-fc1c-2bf2-c2e5a0563f4d
customer constraint id: f328ebe4-b745-5301-a439-cdcf8326ddff
customer bridge id: 665bb51b-a791-5eaa-8035-a42903de5ff7

The test repeatedly removed only shipping_zip, then emitted the supported orders/constraints_reevaluated event.

Before BL-16-UX-BLK-01, reactivation attempted to insert the already-existing deterministic customer constraint ID and crashed the DB projection worker with PostgreSQL 23505 order_constraints_pkey.

After the fix:

poisoned event 90 reprocessed successfully;
canonical customer + inventory rows were both active;
bridge customer + inventory rows were both active;
each logical scope remained exactly one row in each table;
no duplicate deterministic IDs were created;
the projection worker remained running;
later fresh re-evaluations, including events 92 and 94, repeatedly reactivated the same rows successfully.

This is the regression requirement for any future constraint lifecycle change: resolve → reactivate → resolve → reactivate must remain idempotent and worker-safe.


The existing playbook already states that BL-01A re-evaluation re-runs normal evaluator/projection machinery rather than directly clearing constraints, so this lifecycle section extends that exact architecture rather than introducing another model. :contentReference[oaicite:4]{index=4}

## 13. Snapshot metric truth — BL-18, 2026-08-08

Defect: exception_orders counted every row ever written to
order_constraint_events. No is_active filter, no per-order
de-duplication. Monotonic growth; never fell on resolution.

Production evidence, shop 1, snapshot 2026-08-08 14:02:47:
  exception_orders    56
  constrained_orders   9
  distinct blocked orders (canonical)  9
  bridge rows is_active=f              35 of 56
Series: 48 → 49 → 49 → 55 → 56 while constrained_orders
moved 15 → 16 → 15 → 15 → 9.

Surfaced as "56 orders need intervention" via
createOperationalExceptionSignal:47, on the same screen whose
header read 9 blocked (BL-06a).

Fix: misc.metrics.ts:63 now counts at ORDER level from canonical
order_constraints via whereExists, matching constraint.metrics.ts:112.

Local proof: exception_orders 4 → 3, equal to constrained_orders
and to order-level truth. GET /api/v1/modules/order-nexus/ft2
returned exception_orders 3, constrained_orders 3.

RULE — any metric counting ORDERS:
  count FROM orders, whereExists active order_constraints
  never count constraint rows directly
  never read order_constraint_events (deprecated bridge; its
  is_active drifts from canonical — BL-17, 21 rows in production)
Consistent with overview-live-map-playbook §"One fact source →
one signal everywhere".

Open: exception_orders now equals constrained_orders by
construction (BL-19 — product call on whether to retire the field).
