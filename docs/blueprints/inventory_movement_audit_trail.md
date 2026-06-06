# Inventory Movement Audit Trail

## Overview

Every unit of stock must produce an auditable ledger entry from the moment it arrives at the warehouse dock until it leaves as a fulfilled shipment. The `inventory_movements` table is the append-only ledger — rows are never updated or deleted (enforced by DB trigger).

---

## Movement Types

| Type | Direction | Written by | Location |
|------|-----------|------------|----------|
| `inbound_purchase` | `+qty` | `receiveJob.service.ts` → `closeReceiveJob()` | `WH-{n}-ROOT` |
| `location_transfer` | `−qty` + `+qty` (pair) | `stow.service.ts` → `confirmStow()` | source → destination bin |
| `sale` | `−qty` | `pickScan.service.ts` → `confirmPickScan()` | pick bin |
| `reservation_hold` | `+qty` | fulfillment engine | bin |
| `reservation_release` | `−qty` | fulfillment engine | bin |
| `refund_return` | `+qty` | returns service | bin |
| `reconciliation_correction` | `±qty` | manual/reconciliation | any |
| `opening_balance` | any | seed / import | any |

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

PICK (confirmPickScan)
  inventory_movements INSERT:
    movement_type = sale
    quantity_delta = −qty
    location_code  = A-1                ← stock leaves bin
    reference_type = order_revenue_unit
    reference_id   = lasyncro_line_item_id
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

- `inventory_movements` is **append-only** — no UPDATE or DELETE (trigger enforced)
- Every stow produces **two** movements (debit + credit) — ledger always balances
- `device_event_id` is deterministic (`uuidv5`) — safe to retry, prevents double-write
- `stow_tasks.inventory_movement_id` points to the **credit** movement (destination)
- `inventory_truth` is the live read model — derived from movement history, updated in-transaction alongside movements

---

## Migration History

| Migration | Change |
|-----------|--------|
| `0115` | Created `inventory_units` table (LSU records) |
| `0116` | Added `location_transfer` to `inventory_movement_type` enum; updated `inventory_movement_sign_check` constraint to allow `quantity_delta <> 0` (either direction) for transfers. Requires `transaction: false` — PostgreSQL cannot use a new enum value in the same transaction it was added. |

---

## Known Issues / Pitfalls

**Stow movement was missing (fixed in 0116)**
Prior to migration 0116, `confirmStow()` updated `inventory_truth` and `inventory_units` correctly but never wrote `inventory_movements`. The `stow_tasks.inventory_movement_id` column was always NULL. Fixed by adding the debit+credit pair in `confirmStow()`.

**`transaction: false` required for enum migrations**
Any migration that adds an enum value AND uses it in the same file must export `export const config = { transaction: false }`. Without this, Knex wraps both statements in one transaction and PostgreSQL throws error `55P04: unsafe use of new enum value`.

**WH-${shopId}-ROOT hardcoding**
`receiveJob.service.ts` and the fallback path in `stow.service.ts` hardcode `WH-${shopId}-ROOT` as the staging location. This works for single-warehouse shops but breaks multi-warehouse. Tracked in issue #1002.