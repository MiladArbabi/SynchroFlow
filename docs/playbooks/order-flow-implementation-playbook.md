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

### 2.3 Frequency-led, not urgency-led

The main daily job is release-pool work:

```text
build the next wave
release it to the floor
monitor fulfillment
```

Blocked orders are urgent, but not always the most frequent action. Therefore:

```text
Release pool stays the main working canvas.
Blocked orders appear as a persistent alert and compact review panel.
Fulfillment appears as a compact live status strip.
```

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

### 3.1 Order Flow layout

The target page structure is:

```text
Order Flow header
Summary stat cards
Blocked alert strip
Live flow strip
Fulfillment live strip
Blocked review panel
Release pool table
Next wave builder
Release feedback banner
```

### 3.2 Header

The header should communicate live operational state:

```text
10 blocked · $21,899 held · 6 ready to release · 1 batch active
```

### 3.3 Stat cards

Current stat cards:

```text
Blocked
Release pool
Fulfillment
Main action
```

These are high-level operational signals, not deep workflows.

### 3.4 Blocked alert strip

When blocked orders exist, show a persistent theme-aware alert:

```text
10 blocked orders need review
$21,899 is held until customer, inventory, or operational blocks are resolved.
Review blocked →
```

This CTA should not route to a legacy page. It should anchor to the local blocked review panel inside `Order Flow`.

### 3.5 Blocked review panel

The blocked panel should show a compact list of blocked orders using canonical constrained-order data.

Current fields used:

```text
external_order_id
order_id
constraint_type
revenue
recommended_action.type
age_since_creation_seconds
```

Operator-facing labels must be used:

```text
operational → Overdue
inventory → Out of Stock
customer → Address Issue
```

System words should not leak to the operator when a more useful operational label exists.

### 3.6 Release pool table

The release pool table is the main working surface.

It should show:

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

Selecting rows prepares an exclusive selected-order release.

### 3.7 Next wave builder

The wave builder should show:

```text
selected/eligible order count
wave value
zone spread
line items
units to pick
floor capacity
operator assignment
Release wave to floor
```

Important copy:

```text
Pickers see it on their mobile instantly.
```

### 3.8 Fulfillment live strip

Because `Fulfillment` is no longer a primary nav item, `Order Flow` needs a compact fulfillment status strip.

Current fulfillment strip shows:

```text
Fulfillment live
1 picking · 2 pending
1 currently picking
```

This avoids the feeling that released batches disappear after release.

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

Deferred: iso twin (ISSUE-4, phase 2); per-carrier CPT columns + promised_ship_by writer (GitHub #1017).

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
```

### In progress

```text
Verify releaseSuccess banner guard around nullable batchId.
Clean backend indentation around skipped-order block.
Wire skipped_orders fully into frontend release feedback.
Run targeted TypeScript build after frontend/backend contract changes.
```

### Not done yet

```text
Full blocked-order resolution drawer inside Order Flow.
Inline blocked-order action execution.
Compact fulfillment batch cards.
Deep-link panel state such as /orders/flow?panel=blocked.
Order Flow map / isometric warehouse visual.
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
