# INV-RES-01 — Reservation Ownership and Atomic Pick Settlement

**Status:** CLOSED  
**Implementation verified:** 2026-08-10  
**Scope:** batch reservation → physical allocation → pick settlement → completion

---

## Problem

The previous reservation model knew how much inventory a batch held at
variant/location level but did not persist which exact order line owned
each reserved quantity.

That became unsafe when one order line required stock from more than
one physical location.

A line-level pick identity alone could not answer:

```text
which reservation was consumed?
which physical location must change?
which quantity belongs to this task?
have all parts of a split line been picked?
is a retry a new physical action or a replay?
```

---

## Implemented architecture

Migration `0142` adds:

```text
pick_reservation_allocations
```

with ownership:

```text
shop
→ batch
→ order
→ order line
→ variant
→ physical location
→ quantity
```

Migration `0143` adds nullable:

```text
reservation_allocation_id
```

to:

```text
pick_scan_log
pick_exceptions
```

Historical rows remain valid with NULL allocation identity.

---

## Release contract

The existing aggregate inventory allocator remains authoritative for
choosing variant/location quantities.

`reserveBatchInventory()` additionally maps those chosen quantities to
their owning order lines and persists the physical allocation rows.

The reservation ledger and reservation ownership remain separate:

```text
inventory_movements reservation_hold
= aggregate inventory reservation

pick_reservation_allocations
= physical order-line ownership
```

---

## Pick contract

Allocation-backed pick tasks identify:

```text
allocation
line
variant
location
quantity
```

The backend validates the exact persisted allocation before mutation.

Successful settlement performs, in one transaction:

```text
sale movement
+
reservation_release movement
+
inventory_truth decrement
+
confirmed pick_scan_log allocation identity
```

The exact location is authoritative throughout.

---

## Barcode contract

Generic barcode:

```text
EAN / UPC / SKU / external barcode
→ variant identity only
```

Explicit:

```text
LSU-*
→ physical tracked-unit identity
```

Generic resolver results must not cause an arbitrary LSU candidate to
be forwarded as if it were physically scanned.

---

## Completion contract

Allocation-backed order line:

```text
all allocations confirmed
→ line warehouse status = picked
```

Allocation-backed batch:

```text
COUNT(DISTINCT confirmed reservation_allocation_id)
==
COUNT(pick_reservation_allocations)

→ pick_complete allowed
```

Historical zero-allocation batches preserve the legacy completion rule.

---

## Exception contract

Allocation-backed pick exceptions currently fail closed.

Current behavior:

```text
HTTP 409
ALLOCATION_PICK_EXCEPTION_NOT_READY
```

They do not satisfy allocation completion and do not release the
reservation.

Reservation-aware exception settlement is a future design.

---

## Runtime verification

A genuine quantity-six line was reserved across two locations:

```text
A-4 → qty 3
C-1 → qty 3
```

Release produced two persisted physical reservation allocations and a
total held quantity of six.

### First allocation

C-1 qty 3 was confirmed using the generic product SKU.

Verification:

```text
confirmed allocation scan = 1
lasyncro_unit_id = NULL
batch status = picking
units_picked = 3
```

A premature completion attempt returned:

```text
HTTP 409
scanned = 1
total = 2
```

This proves physical allocation cardinality, rather than commerce-line
cardinality, controls completion.

### Second allocation

A-4 qty 3 was confirmed using an explicit tracked LSU.

Final state:

```text
batch status = pick_complete
units_picked = 6
line warehouse status = picked
```

Final sale movements:

```text
A-4 -3
C-1 -3
total -6
```

Final reservation releases:

```text
A-4 -3
C-1 -3
total -6
```

Final inventory truth:

```text
A-4 on_hand=0 reserved=0
C-1 on_hand=2 reserved=0
```

---

## Replay verification

A completed allocation was replayed against the live local endpoint.

The request was rejected because the batch was no longer in `picking`
state.

Verification after replay:

```text
pick scan count unchanged
sale movement count unchanged
reservation_release count unchanged
inventory_truth unchanged
```

---

## Legacy regression verification

A disposable post-change batch with:

```text
allocation_count = 0
confirmed_scans = 1
required_lines = 1
```

completed successfully through the current legacy branch.

The synthetic fixture was then retired as `cancelled`.

Its append-only `pick_scan_log` row was intentionally preserved.

---

## Supporting inventory constraint correction

Split-location verification exposed a cardinality bug in the inventory
constraint evaluator.

Required demand was previously vulnerable to multiplication when joined
against several location-level `inventory_truth` rows.

The evaluator now:

```text
aggregates remaining demand by variant first
→ joins inventory locations second
```

Therefore:

```text
required qty 6
```

remains six regardless of inventory-location cardinality.

---

## Verification gates completed

```text
0142 migration applied
0143 migration applied
RLS verification passed
backend TypeScript check passed
migration TypeScript check passed
WMS module build passed

genuine split reservation passed
first allocation pick passed
premature completion rejection passed
second allocation pick passed
line completion passed
batch completion passed
replay mutation safety passed
legacy zero-allocation completion passed
allocation exception fail-closed verification passed
```

Canonical route:

```text
app.use('/api/v1/wms', wmsRoutes)
```

---

## Follow-up issues discovered

### SESSION-01 — OPEN

Intermittent authentication/session loss was observed during an active
warehouse pick session.

This requires a separate auth/session audit.

### PICK-HTTP-01 — OPEN

A pick scan against a batch no longer in `picking` state is correctly
rejected, but currently falls through to HTTP 500 rather than an
appropriate 4xx state-conflict response.

### Allocation-aware pick exceptions — OPEN DESIGN

A future implementation must explicitly define:

```text
allocation resolution
reservation release/reassignment
replacement task behavior
line completion
batch completion
Problem Center integration
```

Until then, fail-closed behavior remains intentional.

---

## INV-BLOCK-13 — Obsolete reservation writer removed

**Status:** CLOSED — 2026-08-10

`apps/backend/src/services/inventory/reservationLedger.writer.ts` was removed after audit confirmed it had zero callers and no longer matched the transactional reservation model.

Canonical reservation writers remain:

- `batchReservation.service.ts` → `reservation_hold`
- `pickScan.service.ts` → `reservation_release`

Both remain transactionally coupled to their corresponding `inventory_truth` mutations and database uniqueness/sign constraints.

---

## Final invariant

> A batch is a workflow container, not the owner of inventory.  
> The order line owns reservation.  
> Physical allocation scans own inventory truth.