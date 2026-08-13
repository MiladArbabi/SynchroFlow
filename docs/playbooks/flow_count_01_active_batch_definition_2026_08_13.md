# FLOW-COUNT-01 — "batches active" meant two different things

**Date:** 2026-08-13
**Track:** BLOCKED-LIFECYCLE-01 → Order Pool surface
**File:** `apps/backend/src/api/wms/wms.controller.ts`

## Problem

Two surfaces on Order Flow, stacked vertically, both labelled "active":

| Surface | Source | Rule |
|---|---|---|
| Header `OrderFlowPage.tsx:579` | `poolSummary.active_batch_count` | ANY batch holding a `pick_batch_orders` row, all six statuses |
| Rail `OrderFlowPage.tsx:1394` | `batches.length` from `GET /wms/batches` | status NOT IN (`pack_complete`, `cancelled`) — `httpGetBatches:50` |

Production shop 1 read **6** in the header against **3** in the rail: three
batches sitting in `pack_complete`/`cancelled` while retaining membership rows.

The rail's rule is correct — a packed or cancelled batch is not work on the
floor. `active_batch_count` was the outlier.

## Fix

The status exclusion moved onto the `pick_batches` LEFT JOIN condition in the
order-pool summary query, matching `httpGetBatches`.

**Placement is load-bearing.** `pb` is LEFT joined, and five other counters in
the same query (`ready_for_release_count`, `blocked_count`, `fulfilled_count`,
`not_ready_count`, `in_batch_order_count`) read `pbo` / `ofs` /
`active_constraints` across ALL orders including unbatched ones. A top-level
`.where('pb.status', ...)` would drop every NULL-`pb` row from the result set
and silently corrupt all of them. On the join condition, non-matching batches
yield NULL `pb` and only `active_batch_count` changes.

`in_batch_order_count` deliberately unchanged — it counts orders holding a
membership regardless of batch status. Whether a packed batch's orders still
count as "in batch" is a separate product question (BATCH-CANCEL-ORPHAN-01).

## Verified

    baseline  0 / 0 / 0 / 19 / 3 / 0   empty_reason ORDERS_BLOCKED
    post      0 / 0 / 0 / 19 / 3 / 0   empty_reason ORDERS_BLOCKED
    controls  rail 0, constrained 19 — unchanged

**Local proves NO REGRESSION only.** `pick_batches` is empty locally, so the
new exclusion has nothing to act on. Efficacy is unproven until production:
expect `active_batch_count` 6 → 3, matching the rail.

## Withdrawn in the same audit

`FLOW-BLOCKED-BATCHED-01` — prod header 13 blocked vs chip 12 blocked·unbatched.
Both counters are correct: `blockedCount` is ALL constrained,
`summary.blocked_count` is constrained AND unbatched, a distinction BL-06a
qualified deliberately. The delta is one production order that is actively
constrained while holding a batch membership — data, not code. Folds into
`BATCH-CANCEL-ORPHAN-01`.

## Also confirmed, not a defect

`OrderFlowPage.tsx:1376`'s comment claiming `usePickBatches` excludes
`pack_complete`/`cancelled` server-side is **accurate** — verified at
`httpGetBatches:50`. Not the false-justification class of `INV-BLOCK-03`.
