# Inventory Movement Audit Trail

## Overview

Every unit of stock must produce an auditable ledger entry from the moment it arrives at the warehouse dock until it leaves as a fulfilled shipment. The `inventory_movements` table is the append-only ledger — rows are never updated or deleted (enforced by DB trigger).

---

## Movement Types

| Type | Direction | Written by | Location |
|------|-----------|------------|----------|
| `inbound_purchase` | `+qty` | `receiveJob.service.ts` → `closeReceiveJob()` | `WH-{n}-ROOT` |
| `location_transfer` | `−qty` + `+qty` (pair) | `stow.service.ts` → `confirmStow()` | source → destination bin |
| `sale` | `−qty` | `pickScan.service.ts` → `confirmPickScan()` | exact pick allocation location |
| `reservation_hold` | `+qty` | batch reservation / fulfillment path | reserved location |
| `reservation_release` | `−qty` | `pickScan.service.ts` for allocation-backed picks; other fulfillment paths where applicable | exact reserved location |
| `refund_return` | `+qty` | returns service | bin |
| `reconciliation_correction` | `±qty` | manual/reconciliation | any |
| `opening_balance` | any | seed / import | any |

### Reservation ownership — INV-RES-01

`inventory_movements` remains the append-only inventory ledger.

INV-RES-01 adds:

```text
pick_reservation_allocations
```

as an operational ownership table.

It does **not** replace the inventory ledger.

Responsibilities are:

| Concern | Canonical representation |
|---|---|
| Aggregate reservation ledger | `inventory_movements` → `reservation_hold` |
| Physical reservation ownership | `pick_reservation_allocations` |
| Confirmed physical pick | `pick_scan_log` |
| Stock consumption | `inventory_movements` → `sale` |
| Reservation consumption | `inventory_movements` → `reservation_release` |
| Current physical quantity state | `inventory_truth` |

---

## Receive → Stow → Pick Lifecycle

```
RECEIVE (closeReceiveJob)
  inventory_movements INSERT:
    movement_type = inbound_purchase
    quantity_delta = +accepted_qty
    location_code  = WH-1-ROOT          ← stock arrived, not yet binned
    reference_type = receive_job
    reference_id   = receive_job_id

STOW (confirmStow)
  inventory_movements INSERT (debit):
    movement_type = location_transfer
    quantity_delta = −qty
    location_code  = WH-1-ROOT          ← stock leaves staging
    reference_type = stow_task
    reference_id   = stow_task_id

  inventory_movements INSERT (credit):
    movement_type = location_transfer
    quantity_delta = +qty
    location_code  = A-1                ← stock arrives at bin
    reference_type = stow_task
    reference_id   = stow_task_id

  stow_tasks.inventory_movement_id = credit_movement_id  ← linked for traceability

PICK — legacy zero-allocation path (confirmPickScan)
  inventory_movements INSERT:
    movement_type = sale
    quantity_delta = −qty
    location_code  = pick location
    reference_type = order_revenue_unit
    reference_id   = lasyncro_line_item_id

PICK — allocation-backed path (INV-RES-01)
  validate + lock:
    pick_reservation_allocations row
    exact inventory_truth row

  inventory_movements INSERT:
    movement_type = sale
    quantity_delta = −allocation_qty
    location_code  = allocation.location_code

  inventory_movements INSERT:
    movement_type = reservation_release
    quantity_delta = −allocation_qty
    location_code  = allocation.location_code
    reference_type = pick_reservation_allocation
    reference_id   = reservation_allocation_id

  inventory_truth UPDATE:
    on_hand_quantity  -= allocation_qty
    reserved_quantity -= allocation_qty

  pick_scan_log INSERT:
    reservation_allocation_id = allocation_id
    status = confirmed
```

---

## Warehouse Location Hierarchy

```
WH-1-ROOT  (type: warehouse — staging zone, unlocated stock)
  └── A    (type: lane)
       └── A-1  (type: bin, zone_type: pick)
       └── A-2
       └── A-3
       └── A-4
       └── PROBLEM  (type: bin, zone_type: quarantine)
  └── B    (type: lane)
       └── B-1 … B-4
  └── C    (type: lane)
       └── C-1 … C-4
```

`WH-1-ROOT` is the implicit staging location. Stock lands here on receive close, then transfers to a bin on stow. Stock at `WH-1-ROOT` means "in the building but not yet put away."

### Multi-Warehouse (Future)
See GitHub issue #1002. `WH-${shopId}-ROOT` is currently hardcoded. The fix requires a `warehouses` table and user-defined warehouse codes (e.g. `ERFURT`). The LSU path in stow already reads `inventory_units.current_location_code` correctly — only the legacy fallback path and the receive service need updating.

---

## Key Invariants

- `inventory_movements` is **append-only** — no UPDATE or DELETE (trigger enforced).
- Every stow produces **two** movements (debit + credit) — ledger always balances.
- `device_event_id` is deterministic (`uuidv5`) — safe to retry, prevents double-write.
- `stow_tasks.inventory_movement_id` points to the **credit** movement (destination).
- `inventory_truth` is the live read model — derived from movement history and updated in-transaction alongside authoritative mutations.
- A batch is a workflow container; it does not own the physical reservation.
- Allocation-backed reservation ownership is persisted at `order line + variant + location + quantity`.
- An allocation-backed sale must occur at the same location as its reservation allocation.
- Allocation-backed reservation release must reference the exact `reservation_allocation_id`.
- Allocation-backed pick settlement decrements `on_hand_quantity` and `reserved_quantity` together for the exact `inventory_truth` row.
- Split allocations for one order line remain independently identifiable and independently replay-safe.
- A duplicate physical allocation confirmation must never create a second successful `sale` / `reservation_release` pair.

---

## Migration History

| Migration | Change |
|-----------|--------|
| `0115` | Created `inventory_units` table (LSU records) |
| `0116` | Added `location_transfer` to `inventory_movement_type` enum; updated `inventory_movement_sign_check` constraint to allow `quantity_delta <> 0` (either direction) for transfers. Requires `transaction: false` — PostgreSQL cannot use a new enum value in the same transaction it was added. |
| `0142` | Created `pick_reservation_allocations`, persisting reservation ownership at batch → order → line → variant → location → quantity. |
| `0143` | Added nullable `reservation_allocation_id` to `pick_scan_log` and `pick_exceptions`; added uniqueness for confirmed allocation scans and pick-stage allocation exception identity. |

---

## Known Issues / Pitfalls

**Stow movement was missing (fixed in 0116)**
Prior to migration 0116, `confirmStow()` updated `inventory_truth` and `inventory_units` correctly but never wrote `inventory_movements`. The `stow_tasks.inventory_movement_id` column was always NULL. Fixed by adding the debit+credit pair in `confirmStow()`.

**`transaction: false` required for enum migrations**
Any migration that adds an enum value AND uses it in the same file must export `export const config = { transaction: false }`. Without this, Knex wraps both statements in one transaction and PostgreSQL throws error `55P04: unsafe use of new enum value`.

**WH-${shopId}-ROOT hardcoding**
`receiveJob.service.ts` and the fallback path in `stow.service.ts` hardcode `WH-${shopId}-ROOT` as the staging location. This works for single-warehouse shops but breaks multi-warehouse. Tracked in issue #1002.