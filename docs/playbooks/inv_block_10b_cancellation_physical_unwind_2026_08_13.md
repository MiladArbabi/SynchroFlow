# INV-BLOCK-10b — Cancellation physical unwind: accounting proof

**Date:** 2026-08-13
**Severity:** P0
**Source changed:** none — implementation was already correct on disk
**Migration:** none

---

## What this closes

`cancellationUnwind.service.ts` was implemented 2026-08-11 and committed, but
its accounting proof was never captured: the fixture was destroyed by a test-
suite `db:reset` before verification ran, and the substrate could not be
rebuilt until `STOW-SPLIT-01` landed. Before this run, the entire
release -> pick -> cancel -> recover path had **zero runtime execution**: no
`reservation_hold` or `reservation_release` movement had ever been written,
and `stow_tasks` contained only `inbound_stock` rows.

This document is the proof.

---

## Why two allocations were required

The unwind's interesting branch is *mixed*: some allocations released, some
retained. `pick_scan_log_confirmed_allocation_unique` (partial unique on
`reservation_allocation_id WHERE status='confirmed'`) permits exactly one
confirmed scan per allocation, so an allocation is either wholly unscanned or
wholly scanned. A single-allocation line can therefore only ever exercise one
branch.

`allocateRequiredQuantities` fills greedily by `location_rank` (bin=0,
warehouse=1) then `location_code`, breaking as soon as the requirement is
met. To force a spill the order quantity must exceed the first bin's
availability.

Fixture: A-1 available 2, A-2 available 2, order quantity **3**.
Result: allocation #1 A-1 qty 2, allocation #2 A-2 qty 1.

---

## Fixture

order f2f2b26a-5efa-c73b-c397-c96d7275c61a (Shopify 17052988768626, #1197)
line item aad276bc-fd79-57de-ef37-5270b5b5b1a0 qty 3
variant f91e59a9-ebf5-4ac7-ab77-8d0cfef3d902 INV10B-SPLIT-01
allocations d715d3af-efc4-4bd5-a4fe-581fd7fb7d6e A-1 qty 2 (left unscanned)
be7d666e-a591-406d-8b7c-39357c7c66d2 A-2 qty 1 (scanned)
batch 5f4e320f-2be0-4eea-844f-82fb37d51c99
problem task 558f6dbe-0a00-4dff-94f7-c56ba4dfed7b PROB-1-0001
stow task ee67152e-2797-4515-aa42-5caeb1f16f33 order_cancelled_mid_pick
unit LSU-53d4a0aa


Baseline truth: A-1 `2/0/2`, A-2 `2/0/2`. Four units stowed, ledger free of
reservation movements.

### Blocker cleared first

The order arrived with an empty shipping address, raising
`customer/incomplete_address` and excluding it from the release pool.
Cleared via `PATCH /api/v1/orders/:orderId/shipping-address`, which emits
`orders/shipping_address_corrected`; only a real domain event reaches
`projectOrderConstraints`. Constraint went `is_active=false` with
`resolved_at` set (GH-1036 path, confirmed working).

---

## The ledger

09:12:07 reservation_hold +2 A-1 pick_batch RELEASE
09:12:07 reservation_hold +1 A-2 pick_batch
09:15:07 sale -1 A-2 order_revenue_unit PICK (A-2 only)
09:15:07 reservation_release -1 A-2 pick_reservation_allocation
09:17:11 reservation_release -2 A-1 pick_reservation_allocation CANCEL
09:34:16 location_transfer +1 A-1 inventory_unit RECOVER


Reservation conservation: `hold +3` / `release -3` = **net 0**.

Physical conservation: 4 units received, 4 on shelf after the cycle —
A-1 `3/0/3`, A-2 `1/0/1`. All four `inventory_units` rows `stowed`.

Two `reconciliation_correction +10` rows at 09:17:10 land on WH-1-ROOT from
Shopify's cancel-restock; they are `SHOPIFY-RECEIVE-INV-SYNC-01` noise on
staging and sit outside the bin arithmetic.

---

## Stage-by-stage

### 1. Release
Two allocations as predicted. Two `reservation_hold` movements keyed on
`reference_type='pick_batch'`, disambiguated by `location_code` in the
six-column unique index. Truth A-1 `2/2/0`, A-2 `2/1/1`.

### 2. Pick — A-2 allocation only
`confirmPickScan` validates the caller-supplied `allocation_id` against a
seven-field exact match, so a specific allocation can be targeted. Scanning
`be7d666e` wrote `sale -1` **and** `reservation_release -1` at A-2 (the pick
consumes the reservation it uses — this is the writer at
`pickScan.service.ts:302`, not the unwind).

Line status became `picking`, not `picked`: `shouldMarkLinePicked` requires
every allocation for the line to have a confirmed scan (1 of 2). `picking` is
in the unwind's `RETAIN_STATUSES`, which is the state the mixed branch needs.

### 3. Cancel (from Shopify admin)

[CANCEL_UNWIND_ALLOCATIONS_RELEASED] released: 1 releasedQuantity: 2
[CANCEL_UNWIND_PROBLEM_TASK_RAISED] quantity: 1 probLabel: PROB-1-0001


- `d715d3af` (unscanned) -> `reservation_release -2` at A-1,
  `reference_type='pick_reservation_allocation'`,
  `triggered_by='order_cancelled'`; allocation row deleted; truth restored to
  `2/0/2`.
- `be7d666e` (scanned) -> retained, no movement written.
- Problem task raised for the **retained quantity only** (1), not the order
  quantity (3). `prob_label_sequence` 0 -> 1.
- Line and fulfillment status -> `cancelled`.
- **No stow task created at cancellation.** Recovery is deferred to supervisor
  resolution, per the service docblock and INV-PC-01.

`[SHOPIFY_INV_SYNC_FAILED]` did not roll back the internal transaction.

### 4. Resolve — `re_stow`
Blocked on first attempt by `PC-TIER-GATE-01` (fixed and committed separately
at `7991606b`). After that fix:

stow_tasks: ee67152e trigger=order_cancelled_mid_pick quantity=1
status=pending location_code=NULL
source_task_id=558f6dbe lasyncro_order_id=f2f2b26a


**First execution of `order_cancelled_mid_pick` in the system's history.**
No inventory movement written at resolution — truth unchanged. INV-PC-01 holds.

### 5. Stow — credit-only
Confirmed through the operator UI (location-first session, `STOW-SPLIT-01`).

[STOW_LOCATION_ASSIGNED] A-1 <- in_progress reassignment path
[BARCODE_RESOLUTION] unit_barcode LSU-53d4a0aa
[STOW_INVENTORY_CREDIT] quantity: 1 from: null to: 'A-1'
[STOW_CONFIRMED] placedNow 1 quantityPlaced 1 quantityTotal 1
[WMS_STOW_ALERT_FIRED] isActive: false


`from: null` is the whole point. Every prior stow in this ledger wrote a
paired `-1 WH-1-ROOT / +1 bin`. This one wrote a single `+1` at A-1 because
the pick sale had already removed the unit — inventing a debit from PROBLEM
would have double-counted. `reference_id` is `inventory_units.id`
(`b1288b49-...`), per the H2 UUID contract.

---

## Issues verified by this run

| ID | Result |
|---|---|
| `INV-BLOCK-10b` | Mixed release/retain, problem task, deferred recovery, conservation — all proven |
| `INV-BLOCK-10b-LSU-01` | Trigger-aware `unit_ids` CASE returned `LSU-53d4a0aa` for a `picked` unit (committed 2026-08-11, unverified until now) |
| `STOW-COMPLETE-01` | `quantity_placed` 0 -> 1, task closed at threshold |
| `STOW-ALERT-01` | `isActive:false` fired only on full placement |
| `STOW-MOVEMENT-ID-01` | UUID `reference_id`, `reference_type='inventory_unit'` |
| `STOW-SPLIT-01` | Session handled an unfamiliar trigger with no special-casing |
| `POOL-EXCL-VERIFY-01` | Cancelled order excluded from the release pool |

---

## Issues discovered by this run — all OPEN

### REFUND-MOVEMENT-CONFLICT-01 (P0) — CLOSED, fixed in c7972da9
The `refunds/create` handler's `onConflict` names five columns and omits
`movement_type`; `inventory_movements_shop_ref_unique` has six. Postgres
throws *no unique or exclusion constraint matching the ON CONFLICT
specification*, the transaction aborts, and the cascade prevents
`integration_webhook_events.processing_status` from ever being written — so
Shopify retries forever. Observed 6+ times for the same two event ids during
this run. The `refund_return` movement is never written, so refunded stock
never returns to the ledger.

`cancellationUnwind.service.ts` names all six columns and worked first time —
use it as the reference.

### SHOPIFY-RECEIVE-INV-SYNC-01 (P1) — PREMISE FALSIFIED 2026-08-15, re-scope needed
Originally registered as: PO receive writes `inbound_purchase` locally and
pushes nothing to Shopify; inbound `inventory_levels/update` then reconciles
laSyncro *down* to Shopify's uninformed figure. WH-1-ROOT for this variant
reached `-12` via two `reconciliation_correction -5` rows.

Audited 2026-08-15. The stated mechanism is not reachable in current code, and
the proposed fix would introduce a defect:

**Receive correctly does not push.** `shopifyInventorySync.service.ts` uses
`inventoryAdjustQuantities` — delta-based, not absolute. Receive and stow move
the same physical units through two stages of one building (ROOT is the
warehouse root for multi-warehouse; receive → stow is an internal transfer, not
a second entry). Pushing a delta at both stages would report each unit twice —
the 200% overstate shape that RT2-AUD-22 fixed for refunds. One push per unit,
and stow owns it: that is where stock reaches a real bin and becomes pickable.
The `reason: 'received'` string hardcoded in the stow push is a leftover from
before that boundary was settled.

**The webhook does not reconcile.** `handleInventoryLevelUpdate.ts` §182–193
declares an explicit observation-only contract — it must not create
`inventory_movements`, change physical inventory, or reconcile against
`WH-{shopId}-ROOT`. All three `.insert()` calls in the file target
`domain_events`.

**So the corrections came from something else.** The `-12` was real, but its
cause is unidentified. The only non-script code path handling
`reconciliation_correction` is `historicalCanonicalRepair.service.ts`.
Re-scoping requires production data — the dev DB holds zero
`reconciliation_correction` rows and no location carries an
`external_location_id`, so neither the damage nor the stow push is reproducible
locally.

Do not implement a receive-side Shopify push against the original wording.

### BATCH-CANCEL-UNCLAIMED-01 — RESOLVED 2026-08-17

Order Flow now provides an explicit cancellation path for an unclaimed
`pending` pick batch: `POST /api/v1/wms/batch/:batchId/cancel`.

The cancellation transaction locks and re-validates the batch as `pending`,
then uses the immutable batch-level `reservation_hold` ledger rows as the
arithmetic source for reversal. For each hold it writes an equal negative
`reservation_release`, restores `inventory_truth.available_quantity`, reduces
`reserved_quantity`, deletes the operational `pick_reservation_allocations`
and `pick_batch_orders` rows, and preserves the batch as `status='cancelled'`.

Local verification on 2026-08-17 proved both the 12-unit and 1-unit cases.
For the final UI fixture (`46c4faf8-e63e-4ef4-a245-771443eceb76`):

- batch remained preserved as `cancelled`, `units_picked=0`
- memberships: `0`
- reservation allocations: `0`
- reservation hold `+1` / release `-1` / net `0`
- inventory truth at `A-2`: on-hand `1`, reserved `0`, available `1`,
  sellable `1`
- shop-wide negative inventory rows: `0`
- the released order returned immediately to the Order Pool
- retrying cancellation returned `409`
- claiming a cancelled batch returned `409`
- once a different batch was legitimately claimed/started, the cancellation
  control was no longer available and the backend would reject cancellation

This does **not** close `BATCH-CANCEL-ORPHAN-01` below. That issue concerns an
individual order cancelled after its batch has already entered picking; this
new endpoint deliberately refuses non-`pending` batches.

### BATCH-CANCEL-ORPHAN-01 (P2)
The unwind touches neither `pick_batches` nor `pick_batch_orders`. Batch
`5f4e320f` remains `status='picking'` with `units_picked=1` and a live
`pick_batch_orders` membership row for the cancelled order. Related to
`BATCH-CANCEL-01`.

### INV-BLOCK-10b-FU-01 (P2)
`markLineCancelled` issues an `UPDATE ... WHERE lasyncro_line_item_id = ?`
that silently affects 0 rows when no `order_line_item_warehouse_status` row
exists — reachable because the service's `leftJoin` admits lines with a null
warehouse status. The replay guard
(`lines.every(l => l.warehouse_status === 'cancelled')`) therefore cannot trip
for an order that was never released. Violates the no-silent-failure rule.

### Observability gap (P4)
`[PROBLEM_CENTER_RE_STOW_TASK_CREATED]` logs `problem_task_id` but not the new
`stow_task_id`, so resolution -> stow task cannot be traced from logs alone.

---

## Operational notes for the next engineer

**RLS.** Querying tenant tables through `sf_app` without
`SET LOCAL "app.current_tenant"` returns zero rows on a populated database.
Never infer "database wiped" from that. Audit through `sf_user`.

**Schema.** `orders` has no `status`, `cancelled_at`, or external id column —
commercial status lives in `order_fulfillment_status`, external identity in
`external_order_identity_map`. `order_constraints` uses `is_active` /
`resolved_at`, not `status`. `inventory_truth` columns are
`on_hand_quantity` / `reserved_quantity` / `available_quantity`. There is no
`pick_tasks` table. Run `\d` before querying any table whose columns are not
already in context.

**Sign convention.** `inventory_movement_sign_check` requires
`reservation_hold > 0` and `reservation_release < 0`. `quantity_delta` is
pre-signed; `rebuildInventoryProjection` sums both as-is into
`reserved_quantity`, so hold/release round-trip to zero on rebuild.

## Related

- `docs/playbooks/inv_block_10a_cancellation_ingress_2026_08_10.md`
- `docs/playbooks/inv_block_10c_cancelled_constraint_resolution_2026_08_10.md`
- `docs/playbooks/pc_tier_gate_01_problem_center_starter_2026_08_13.md`
- `docs/playbooks/stow_split_01_location_first_per_unit_2026_08_12.md`
