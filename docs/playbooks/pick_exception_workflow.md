# Pick Exception Workflow

**Status:** LIVE — GH-1049 Pick-core implemented and verified 2026-09-09
**Issue:** GitHub #1049 — `PICK-EXC-01: Pick exception UI/backend contract mismatch`

This playbook is the authoritative contract for Pick-stage warehouse exceptions.

It supersedes older documentation that said allocation-backed Pick exceptions must
fail closed with `ALLOCATION_PICK_EXCEPTION_NOT_READY`.

---

## 1. Operational principle

There are two different inventory moments.

### Before release to the warehouse floor

Authoritative inventory is revalidated during batch release.

If an order is no longer pickable before release:

```text
Order Pool
→ release-time inventory revalidation fails
→ Blocked Orders
```

Do not knowingly release impossible work to the floor.

### After the picker has claimed the work

Once the batch is on the floor, do not pull work away from the picker because
physical reality differs from system inventory.

```text
Picker discovers discrepancy
→ report Pick exception
→ account for that allocation's Pick work
→ continue healthy Pick tasks
```

A Pick exception does **not** detach, requeue, or remove the affected order from
the batch.

The affected order remains part of the batch and reaches downstream Pack
context, where unresolved Pick exceptions can later block fulfillment of that
specific order.

Pack gating/custody is a later implementation slice.

---

## 2. Operator-visible Pick exception taxonomy

Web and mobile operators use exactly:

```text
item_missing
short_pick
product_defect
packaging_defect
wrong_item
```

`order_cancelled` remains a system-level exception type. It is not an
operator-selectable Pick exception.

---

## 3. Canonical client/server contract

A Pick exception report carries:

```text
lasyncro_line_item_id
lasyncro_variant_id
reservation_allocation_id
exception_type
stage = pick
quantity_required
quantity_found
device_event_id
```

`device_event_id` is stable across retry of the same operator action.

The client performs exactly one Pick-exception write.

It does **not** separately create a Problem Center task.

Problem-task creation is server-owned.

Canonical server helper:

```text
apps/backend/src/services/wms/problemCenterTask.service.ts
createProblemCenterTask(...)
```

The helper receives the caller's transaction. It does not open a second
transaction.

---

## 4. Allocation identity and locking

`pick_reservation_allocations` is immutable execution identity.

Do not UPDATE an allocation merely because its Pick outcome changes.

Both normal confirmed Pick and Pick-exception handling serialize on the same
allocation row using `FOR UPDATE`.

This prevents two incompatible physical outcomes from winning concurrently.

Existing database guards remain authoritative:

```text
pick_scan_log_confirmed_allocation_unique
pick_exceptions_pick_allocation_unique
```

A `short_pick` is the deliberate exception to an otherwise single-outcome
mental model: one allocation may have both a partial confirmed scan and one
Pick exception as one atomic composite operation.

---

## 5. Quantity semantics

```text
quantity_required = quantity expected for the allocation
quantity_found    = quantity physically found by the picker
missing_quantity  = quantity_required - quantity_found
```

Examples:

```text
item_missing: required 5, found 0, missing 5
short_pick:   required 5, found 3, missing 2
```

The system must never represent missing units as physically picked.

---

## 6. Item missing and non-short discrepancies

For a fully missing allocation:

```text
allocation quantity = 5
quantity_found = 0
```

The transaction creates:

```text
Pick exception
linked Problem Center task, quantity 5
```

It does not create:

```text
pick_scan_log
pick_removal
reservation_release
inventory_truth mutation
```

The allocation remains held and unchanged until a later disposition resolves
the remaining reservation.

The same non-fabrication rule applies when the reported discrepancy does not
represent a physical partial Pick.

---

## 7. Short pick — atomic composite contract

Example:

```text
allocation quantity = 5
picker physically finds = 3
missing = 2
```

One transaction records:

```text
confirmed pick_scan_log quantity_confirmed = 3
pick_removal             quantity_delta = -3
reservation_release      quantity_delta = -3
inventory_truth.on_hand  -= 3
inventory_truth.reserved -= 3
pick_batches.units_picked += 3

Pick exception:
  quantity_required = 5
  quantity_found    = 3

Problem Center task:
  quantity = 2
```

The allocation row remains unchanged.

`available_quantity` is not increased by the Pick-time partial reservation
release because the three physically picked units leave on-hand at the same
time.

### Economic identity

The short-pick physical movements use the Pick exception as their economic
reference.

They do not consume the allocation-wide reservation-settlement identity.

The remaining reservation belongs to a later explicit disposition and must
have its own economic identity.

---

## 8. Pick completion invariant

Allocation-backed Pick completion is quantity-accounted.

For each allocation:

```text
accounted =
  confirmed physical quantity
  +
  exception missing quantity
```

where:

```text
exception missing quantity =
  quantity_required - quantity_found
```

Completion requires:

```text
accounted == allocation.quantity
```

Examples:

```text
normal:      5 = 5 + 0
short pick:  5 = 3 + 2
missing:     5 = 0 + 5
incomplete:  3 != 5
```

An unresolved Pick exception may therefore allow the **Pick stage** to finish.

That does not mean the affected order is authorized for shipment.

Pick completion and fulfillment authorization are separate contracts.

---

## 9. Problem Center incident ownership

A Pick exception creates exactly one linked Problem Center task server-side in
the same transaction.

For the GH-1049 Pick path:

```text
problem_center_tasks.source = pick
source_exception_id = pick_exception_id
source_pick_exception_id = pick_exception_id
quantity = missing/problem quantity
```

Migration `0169_pick_exception_event_identity` provides a dedicated Pick
exception FK and uniqueness guard without changing the legacy meaning of
`source_exception_id` for cancellation and returns flows.

A missing configured `problem_bin_location` does **not** prevent creation of the
Pick incident.

The GH-1049 Pick path also does not increment `prob_label_sequence` and does not
print a new `PROB-*` physical label.

---

## 10. Idempotency and concurrency

### Exact replay

Same `device_event_id` + same semantic request:

```text
→ same pick_exception_id
→ same Problem task
→ no duplicate scan
→ no duplicate movement
→ no duplicate inventory mutation
→ no duplicate batch progress
```

The replay receives canonical success.

### Event-key misuse

Same `device_event_id` with materially different request content:

```text
→ deterministic conflict
```

### Different events against one allocation

Two distinct events attempting incompatible outcomes:

```text
→ one winner
→ one deterministic conflict
```

### Scan vs exception race

Normal full Pick and Pick exception serialize on the same allocation lock.

They cannot both independently win.

### Atomic failure

If downstream server-owned Problem-task creation fails, the entire Pick
exception transaction rolls back.

No half-written exception, task, scan, movement, reservation release,
`inventory_truth` mutation, or `units_picked` mutation may survive.

---

## 11. Problem Station, Problem Bin and physical custody

The product model distinguishes three concepts:

```text
Problem Station
= fixed warehouse work area/location

Problem Bin
= shared scannable operational custody container

Problem task / PROB reference
= incident identity, not the physical item identity
```

Problem Bins may contain items from multiple orders/incidents.

An LSU-labelled item keeps its LSU identity. Do not require another PROB barcode
to be attached to it merely because it enters problem custody.

The intended future custody flow is:

```text
scan LSU / identify quantity
→ scan nearby Problem Bin
→ record custody
→ place item in shared bin
→ continue warehouse work
```

Custody placement itself is not an inventory movement and does not make stock
sellable.

**GH-1049 Pick-core does not yet implement Problem Bin container/custody
persistence.**

---

## 12. Downstream scope boundary

GH-1049 Pick-core intentionally does not complete these later contracts:

- Pack gate for orders with unresolved Pick exceptions
- Problem Bin/container persistence
- LSU → Problem Bin custody
- all-missing order handling at Pack
- owner/admin resolution concurrency
- residual reservation settlement
- re-stow idempotency
- write-off/discard settlement
- true partial fulfillment
- recount creation/coalescing
- recount freshness correction

The owner/admin/problem solver remains the eventual commercial decision-maker.

A Pick exception or recount result does not itself authorize shipment.

---

## 13. Verification contract

Permanent regression coverage:

```text
tests/contract/pick-exception-1049.contract.test.ts
tests/integration/wms/pick-exception-allocation-1049.test.ts
```

Verified 2026-09-09:

```text
contract:             6 passed / 6
backend integration:  9 passed / 9
```

The integration suite runs against a migrated disposable
`synchroflow_test_*` PostgreSQL database using the restricted runtime role and
proves database cleanup after execution.

---

## 14. Canonical implementation surfaces

```text
apps/backend/src/api/wms/wms.controller.ts
apps/backend/src/services/wms/pickScan.service.ts
apps/backend/src/services/wms/problemCenterTask.service.ts
apps/backend/migrations/20260909120000_0169_pick_exception_event_identity.ts

modules/wms/src/ui/pages/PickSessionPage.tsx
modules/wms/src/ui/pages/WmsModuleFT2.tsx
apps/frontend/src/pages/ft2-pages/WmsOperationsPage.tsx

apps/mobile/src/screens/PickBriefScreen.tsx
apps/mobile/src/ui/ProblemSheet.tsx
```

When another document conflicts with this playbook on the GH-1049 Pick-stage
contract, this playbook is authoritative unless a later dated implementation
explicitly supersedes it.
