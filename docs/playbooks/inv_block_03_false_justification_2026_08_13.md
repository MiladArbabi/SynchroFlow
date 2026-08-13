# INV-BLOCK-03 — a skip defended by three false claims

**Date:** 2026-08-13
**Track:** BLOCKED-LIFECYCLE-01 → inventory blocker group
**File:** `apps/backend/src/api/wms/wms.controller.ts` (`httpConfirmStow`)
**Registered:** Sprint 5, unactioned across Sprints 6-10

## Problem

`httpConfirmStow` carried a commented-out `rebuildInventoryProjectionForVariants`
call plus a NOTE justifying the omission. Every load-bearing claim was false:

| Claim | Reality |
|---|---|
| "no new movement is written on stow" | confirmStow writes TWO location_transfer movements — `stow.service.ts:503` debit, `:533` credit |
| "per inventory contract INV-02" | INV-02 is `fontWeight: 700` in ProductsModuleFT2 (`InventoryModule.md:143`), a P2 styling issue resolved May 2026. No such inventory contract exists |
| "rebuilding would erase the location transfer" | Inverted. The movements exist, so a replay REPRODUCES the transfer. The ledger is authority over inventory_truth, not the reverse |

The comment survived INV-BLOCK-19, INV-BLOCK-20, STOW-SPLIT-01 and the whole
10b track untouched.

## Behaviour was correct; the reasoning was not

No executable line changed. The skip stands, for the real reasons:

1. `confirmStow` already mutates `inventory_truth` directly AND writes both
   balancing movements — a per-variant rebuild in the same transaction is
   redundant work on the hot stow path.
2. INV-BLOCK-20's synchronous `revalidateOrdersForReceivedVariants` (:1915)
   already delivers the constraint re-evaluation the rebuild was meant to enable.

Both sites sit in the SAME handler and the SAME `if (task?.lasyncro_variant_id)`
block, sequentially — not divergent branches. That was the audit's decisive
question: a live unguarded stow path would have been a behaviour defect.

## Dead code removed

`wms.controller.ts` has no import for `rebuildInventoryProjectionForVariants`.
The commented-out call could never have been uncommented as-is — it read as a
switch and was not one. The function remains live elsewhere
(`seed_fresh_install.ts:177`, `shopify.service.ts:145` dynamic import).

## Registered

`INV-BLOCK-03-FU-01` (P2) — the `order_cancelled_mid_pick` trigger stows
credit-only: `+1` at destination, no matching `-1`, because the pick sale
already removed the unit. A rebuild summing movements may land somewhere
different from what confirmStow wrote directly. Whether ledger and truth agree
across all four stow triggers is unverified. If they diverge, this skip is
protecting a real inconsistency rather than avoiding redundant work.

## Verified

    old NOTE + dead call   gone
    new note               :1835, caveat :1859
    INV-BLOCK-20 control   import :25, call :1915 — intact
    tsc -p apps/backend    clean

## Lesson

A comment citing an issue ID is not evidence. INV-02 was a fontWeight ticket
and the citation went unchallenged for months because the ID looked plausible
in context. Grep the ID before trusting the claim it supports.
