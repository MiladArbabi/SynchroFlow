# INV-SALE-DOUBLE-01 — one physical debit per unit

**Date:** 2026-08-14
**Migration:** 0147 `add_pick_removal_movement_type`
**Files:** `pickScan.service.ts`, `rebuildInventoryProjection.ts`,
`historicalCanonicalRepair.service.ts`, `wmsAnalytics.service.ts`,
`members.controller.ts`

## Problem

Two writers debited the same units:

    revenue-units.writer.ts:274   'sale' at order ingestion   (universal)
    pickScan.service.ts:259       'sale' at operator scan     (floor only)

Every on-hand computation summed both. Nine ordered units on shop 2 produced
ten `sale` rows totalling -18.

`rebuildInventoryProjection` treats the ledger as authority over
`inventory_truth`, so a rebuild would have driven on-hand from a true 116 to
107 — a phantom 9-unit shortage for stock that never left the building.

The six-column `inventory_movements_shop_ref_unique` never fired, and no
conflict target could have caught this: each writer derives its
`device_event_id` from its own `uuidv5` namespace, so each is idempotent
only against ITSELF and blind to the other. `onConflict(['device_event_id'])`
is the real guard at both sites.

## Why ingestion keeps `sale`

Option B (remove ingestion's debit, make pick authoritative) was audited and
rejected on evidence:

- **Orders ship without ever being picked.** Shop 1: 3 of 3 fulfilled orders
  had zero pick scans. Their only physical debit is ingestion's `sale`.
- **No ship-time debit exists.** `httpShipBatch` (`wms.controller.ts:1471`)
  writes no movement. Neither does `handleOrderFulfillment.ts` — it has no
  inventory effect at all.
- **`historicalCanonicalRepair:1106` hard-depends on the ingestion row.** It
  queries `movement_type='sale' + reference_type='order_revenue_unit' +
  reference_id=lasyncro_revenue_unit_id` and **throws** if absent.

The ingestion `sale` row must remain because downstream economic and canonical
repair logic identifies it. What changed after `INV-INGEST-TRUTH-01` is its
**physical meaning**: the row remains in the ledger but is no longer an
on-hand debit.

## Final physical-truth model

Migration 0147 introduced `pick_removal` so a confirmed WMS pick has an
explicit physical movement distinct from the ingestion `sale`.

`INV-INGEST-TRUTH-01` completed that model:

- ingestion `sale` is economic-only
- release reserves inventory without changing on-hand
- `pick_removal` is the physical debit for a confirmed WMS pick
- migration 0148 adds `fulfillment_removal` for Shopify fulfillment quantity
  that was not already physically picked
- fulfillment of already-picked quantity does not debit inventory again
- duplicate fulfillment is idempotent
- ambiguous or missing fulfillment locations fail instead of guessing

The earlier statement that `pick_removal` must be excluded from on-hand
reconstruction is therefore superseded. Rebuild must include physical
`pick_removal` and `fulfillment_removal` movements while excluding ordinary
economic ingestion sales.

Legacy compatibility is intentional:

- pre-0147 pick rows encoded as `sale` + `triggered_by='pick_scan'` remain
  physical during rebuild
- `inv_sale_backfill_01` compensating reconciliation rows are physically
  neutral
- `canonical_repair` compensating reconciliation rows are physically neutral

## Runtime validation

Fresh shop-2 verification established:

    ingestion       physical truth unchanged
    release         on-hand unchanged; reserved increases
    pick            on-hand decreases; reservation consumed
    fulfillment     unpicked quantity physically debited once
    duplicate       no second physical debit
    picked+fulfilled no second physical debit
    rebuild         reproduces current physical truth exactly

Final rebuild truth:

    CWB-002   24 / 0 / 24
    MCS-001   39 / 0 / 39
    WBE-003   58 / 0 / 58

## Current implementation sites

| Site | Current responsibility |
|---|---|
| `pickScan.service.ts` | writes `pick_removal`; rejects shipped-line picks |
| `fulfillmentPhysicalRemoval.service.ts` | writes fallback `fulfillment_removal`, consumes unpicked reservations, refuses ambiguous/missing locations |
| `orders.fulfilled.ts` | invokes fallback physical removal only for fulfilled state |
| `rebuildInventoryProjection.ts` | reconstructs physical truth with current and legacy compatibility rules |
| `historicalCanonicalRepair.service.ts` | applies the same physical/economic classification during repair |
| `wms.controller.ts` | maps shipped-line stale pick attempts to HTTP 409 |
| migration 0148 | adds `fulfillment_removal` and updates movement sign validation |

### Why the three readers had to move

They measure **operator activity**, and they isolate it by requiring
`operator_id` and `scan_source` to be non-null. Only `pickScan` sets those
fields — verified 5/5 on pick rows, 0/31 on ingestion rows.

Left on `sale`, they would have kept running and returned **nothing** for
every new pick: an operator's card showing zero scans after a full day on
the floor. No error, no warning, just a dashboard silently going blank.

### Deliberate exception

`wmsAnalytics.service.ts:315` stays on `'sale'`. It computes
`MIN(occurred_at) AS first_sale_at` for receive-to-sale lead time, with no
operator guard. Ingestion's timestamp is the earlier one, so it already
returns what it returns; retargeting would change the metric's meaning on a
guess about intent.

## Effect on INV-BLOCK-10b

10b's credit-only `order_cancelled_mid_pick` stow is **repaired**, not broken.

    movement                        before C1   after C1
    ingestion sale        -1           -1         -1
    pick (sale/removal)   -1           -1          0
    unwind reservation_release         0           0
    stow credit location_transfer +1  +1          +1
    net on-hand                       -1 WRONG     0 CORRECT

The unwind writes only `reservation_release` for unscanned allocations
(full-file read confirms; header states it at lines 36-39: *"no inventory
movement is written for the picked unit here"*), which feeds `reserved`,
never `on_hand`.

`stow.service.ts:178-180`'s comment — *"the pick sale already removed the
physical unit"* — reached the right conclusion from a false premise. TWO
sales removed it, and the removal it names happened in truth via direct
mutation, not in the ledger. Same shape as INV-BLOCK-03.

## ⚠️ BACKFILL OUTSTANDING

Rows written before 0147 keep `movement_type = 'sale'`: **5 on shop 2 only**
— corrected by INV-SALE-BACKFILL-01 the same day; shop 2's ledger now
reconciles with truth at 116.

**Shop 1 has none.** Its 26 `sale` rows are all `triggered_by = NULL`
(ingestion). Verified: 0 rows in `pick_scan_log`, 0 in `pick_batches`.
An earlier draft of this playbook said "26 on shop 1" — wrong, and acting on
it would have written 26 spurious corrections into an append-only table.

Shop 1's 32-unit divergence is separate: `INV-TRUTH-LEDGER-DRIFT-01`, a
`dev_seed` ordering artefact.

The margin-snapshot integrity worker actively recommends that command:

    [MARGIN_SNAPSHOT_INTEGRITY_DRIFT]
      remediation: 'Run rebuild-from-events (or targeted recompute) ...'

Registered as `REBUILD-UNSAFE-01` (P1).

Shop 1 additionally carries a separate 32-unit divergence caused by
`dev_seed` writing `opening_balance` movements 27 minutes AFTER the sales
that consume them — a seed-ordering artefact, not a runtime defect
(`INV-TRUTH-LEDGER-DRIFT-01`, P2, dev-fixture only).

## Also registered

`INV-ONHAND-DUP-01` (P2) — the on-hand movement-type list is duplicated
across three files (`rebuildInventoryProjection:123`,
`historicalCanonicalRepair:515`, `:770`) with no shared constant. It is why
this change had to touch three files instead of one.

## Verified

    migration 0147   applied batch 2, 13 enum values, sign check carries
                     pick_removal in the negative arm
    ADD CONSTRAINT   validated against all 80 existing rows, no failure
    pickScan         writes pick_removal, no 'sale' write remains
    ingestion        :274 untouched
    readers          3 retargeted, wmsAnalytics:315 exception documented
    tsc              clean

## Gotcha

The rebuild's on-hand CASE lives inside a `trx.raw()` template literal. A
comment containing backticks terminates the string. Use quotation marks.
