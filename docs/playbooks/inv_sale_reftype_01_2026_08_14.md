# INV-SALE-REFTYPE-01 — two entity types under one reference_type

**Date:** 2026-08-14
**Track:** Reviewer rehearsal → inventory ledger correctness
**File:** `apps/backend/src/services/wms/pickScan.service.ts`
**Parent:** `INV-SALE-DOUBLE-01` (P1, open)

## Problem

Two writers, one label, two entity types:

    pickScan.service.ts:259    reference_type 'order_revenue_unit'
                               reference_id   lasyncro_line_item_id     ← LINE ITEM
    revenue-units.writer.ts    reference_type 'order_revenue_unit'
                               reference_id   lasyncro_revenue_unit_id  ← REVENUE UNIT

`reference_id` is a `uuid` column, so both are structurally valid and nothing
complains. Proven on shop 2: the five pick-written `sale` rows carry the exact
line-item ids logged by `[PICK_SCAN_CONFIRMED]`.

## Fix

`reference_type` → `'order_line_item'`. Names the entity actually referenced,
matching the existing vocabulary (`pick_batch`, `pick_reservation_allocation`,
`inventory_unit`, `receive_job`, `opening_balance` — all entity-named).

Safe because:
- `reference_type` is `character varying`, NOT an enum. No migration.
- No reader filters on it. Verified: `grep -rn "where.*reference_type"` empty.
  All hits are onConflict column arrays or display selects.

## What this does NOT fix

**The double debit stands.** 9 ordered units produced 18 debited on shop 2 —
one `sale` at ingestion, one at pick, for the same units.

The real guard on both writers is `onConflict(['device_event_id'])`, NOT the
six-column `inventory_movements_shop_ref_unique`. Each derives its
`device_event_id` via `uuidv5` from a different namespace and seed:

    pickScan          `${pickBatchId}:${pickTaskIdentity}:sale`  PICK_SCAN_NAMESPACE
    revenue-units     `${lasyncro_revenue_unit_id}:sale`         REVENUE_UNIT_NAMESPACE

So each is idempotent against ITSELF and blind to the other. No conflict target
change would have caught this — the two writes are genuinely distinct rows
representing the same physical event.

What this cycle buys: the pick-written rows become queryable as a set, which is
what `INV-SALE-DOUBLE-01`'s backfill needs.

## ⚠️ REBUILD-UNSAFE-01 (P1)

`rebuildInventoryProjection.ts:134` sums `sale` into `on_hand`, and `:175`
documents that negative on_hand is legitimate — so nothing clamps or flags it.

**Do not run `rebuild-from-events` on a tenant that has picked** until
INV-SALE-DOUBLE-01 lands. Shop 2 would go from a true 116 to 107, inventing a
9-unit shortage for stock that never left the building.

The margin-snapshot integrity worker is ACTIVELY RECOMMENDING this command:

    [MARGIN_SNAPSHOT_INTEGRITY_DRIFT]
      remediation: 'Run rebuild-from-events (or targeted recompute) ...'

## Evidence (shop 2, reviewer rehearsal fixture)

    opening_balance   3 rows   +125
    sale             10 rows    -18   ← 9 units, debited twice
    reservation_hold  3 rows     +9
    reservation_release 5 rows   -9   ← net 0, reservations correct
    inventory_truth on_hand     116   = 125 - 9, debited ONCE

Truth is right. The ledger is not. The ledger wins on rebuild.

## Verified

    edit landed        :263 comment, :291 'order_line_item'
    ingestion control  :276 still 'order_revenue_unit'
    tsc -p apps/backend clean

## Not in scope

Backfill of the five existing shop 2 rows. `inventory_movements` is append-only
by trigger, so correction means compensating movements, not UPDATE. Belongs
with INV-SALE-DOUBLE-01's backfill decision.
