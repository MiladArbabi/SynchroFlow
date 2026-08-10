# INV-BLOCK-04 — Stow Source Semantics and Inventory Conservation

**Status:** CLOSED  
**Implementation verified:** 2026-08-10  
**Scope:** WMS stow confirmation → source inventory → destination inventory → inventory movements

---

## Problem

`confirmStow()` previously treated every stow as if inventory already existed at a warehouse source location.

For ordinary stows the default source was:

```text
WH-{shopId}-ROOT

The source decrement used a clamped mutation:

GREATEST(0, source - stow_quantity)

while the destination always received the full stow quantity.

Therefore a transfer could manufacture inventory.

Example:

ROOT on_hand = 2
stow quantity = 5

old result:

ROOT = 0
destination = 5

warehouse total:
2 → 5

The task schema also does not persist a generic physical source location, while different stow triggers represent different inventory semantics.

Audited stow semantics
inbound_stock

The receive-close workflow first credits accepted stock into:

WH-{shopId}-ROOT

and then creates the stow task.

Therefore receive-created inbound_stock is a true physical transfer:

ROOT
→ destination bin

It must conserve inventory.

The backend also exposes manual:

POST /api/v1/wms/stow-tasks

which creates an inbound_stock task.

No active frontend or mobile caller was found during the audit.

Because that endpoint does not establish separate source provenance, confirmation must fail closed when sufficient ROOT/source inventory does not exist.

problem_center

Problem Center re-stow already resolves an explicit source from:

problem_center_tasks.problem_bin_location

This remains a true transfer:

problem bin
→ destination bin

The destination must remain an active bin and the source and destination must differ.

return_restock

A resellable return creates a return_restock stow task without first crediting warehouse inventory_truth.

Therefore it is not a transfer from ROOT.

Its correct semantics are:

returned physical item
→ destination inventory credit

No ROOT/source debit is valid.

order_cancelled_mid_pick

No active creation path was established during INV-BLOCK-04.

Cancellation lifecycle semantics remain deferred to:

INV-BLOCK-10

and were intentionally not redesigned as part of this issue.

Implemented contract

confirmStow() now distinguishes inventory-credit stows from transfer stows.

Transfer stows

Current transfer paths:

inbound_stock
problem_center

must resolve a source location.

The source mutation is now guarded atomically by:

on_hand_quantity >= stow_quantity
AND
available_quantity >= stow_quantity

Only a successful full source debit permits the destination credit.

The old clamped behavior:

GREATEST(0, ...)

is no longer used for stow source settlement.

If the guarded source update does not affect exactly one row, confirmation fails.

HTTP confirmation maps insufficient source inventory to:

HTTP 409
Insufficient stock at stow source

Missing transfer source resolution also fails closed with HTTP 409.

Return-restock contract

return_restock is now explicitly treated as an inventory credit.

It performs:

destination inventory_truth + quantity

and writes:

refund_return +quantity

at the destination.

It does not:

debit WH-{shopId}-ROOT
write a negative location_transfer
invent a warehouse source

This preserves the existing returns-intelligence refund_return movement contract while preventing unrelated ROOT inventory from being consumed.

Movement contract
Valid transfer
source:
location_transfer -quantity

destination:
location_transfer +quantity
Return restock
source:
no movement

destination:
refund_return +quantity
Runtime verification
A — Insufficient transfer source

Test fixture:

trigger = inbound_stock
quantity = 1
source = WH-1-ROOT
destination = A-1
ROOT inventory row = absent

Confirmation returned:

HTTP 409
{"error":"Insufficient stock at stow source"}

Post-verification:

task status = in_progress
inventory_movement_id = NULL

ROOT inventory = unchanged
destination inventory = unchanged
inventory movements = 0

The temporary task was deleted after verification.

This proves an invalid transfer cannot manufacture destination inventory.

B — Return restock credit-only

A disposable return_restock task was confirmed inside a rollback transaction.

Initial state:

ROOT = absent
A-1 = absent
quantity = 1

Inside the transaction:

ROOT = unchanged / absent

A-1:
on_hand = 1
available = 1

Movement result:

refund_return +1 @ A-1

There was no debit movement.

Assertions:

rootUnchanged = true
destinationCredited = true
creditOnly = true
taskCompleted = true

The transaction was rolled back.

Final verification:

taskCount = 0
movementCount = 0
rootRestored = true
destinationRestored = true
C — Valid transfer conservation

A disposable valid transfer was tested inside a rollback transaction.

Initial source:

WH-1-ROOT
on_hand = 2
available = 2

Stow:

quantity = 1
destination = A-1

Confirmed state:

WH-1-ROOT:
on_hand = 1
available = 1

A-1:
on_hand = 1
available = 1

Movements:

location_transfer -1 @ WH-1-ROOT
location_transfer +1 @ A-1

Result:

VALID_TRANSFER=PASS
TRANSACTION_ROLLED_BACK=yes
TASKS_AFTER_ROLLBACK=0

This proves a valid transfer still succeeds while conserving warehouse inventory.

Files changed
apps/backend/src/services/wms/stow.service.ts
apps/backend/src/api/wms/wms.controller.ts
docs/playbooks/inv_block_04_stow_source_semantics_2026_08_10.md

No migration was required.

Verification gates completed
audit of stow task schema completed
route manifest verified
all active stow creation paths scanned
receive-created inbound_stock semantics verified
problem_center source semantics verified
return_restock creation semantics verified
manual POST /stow-tasks caller scan completed

backend source syntax verification passed
local /health returned HTTP 200

insufficient-source transfer rejection passed
failed-transfer rollback safety passed
return-restock credit-only verification passed
return-restock no-ROOT-debit verification passed
valid transfer conservation verification passed
all disposable runtime fixtures cleaned or rolled back
Follow-up
INV-BLOCK-10

Order cancellation / mid-pick inventory lifecycle remains a separate issue.

order_cancelled_mid_pick must not inherit semantics from INV-BLOCK-04 without its own end-to-end audit covering:

Shopify cancellation ingestion
reservation state
pick state
pack state
inventory ownership
Problem Center
re-stow behavior
Final invariant

A stow transfer may only move inventory that already exists at its resolved source.
A return restock is an inventory credit, not a fabricated transfer from ROOT.
