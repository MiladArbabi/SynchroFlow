# FLOW-BUCKET-ELECTION-01 + FLOW-MULTIBLOCK-01

**Date:** 2026-08-13
**Track:** BLOCKED-LIFECYCLE-01 — blocked order filter
**Files:** `apps/backend/src/api/orders/orders.constrained.controller.ts`,
`apps/frontend/src/pages/orders/useConstrainedOrders.ts`,
`apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx`

## Problem

`order_constraints` holds multiple active rows per order by design
(`uniq_active_constraint_per_scope` = order + type + target_id).
`/orders/constrained` collapses them with `DISTINCT ON (lasyncro_order_id)`.

The ordering chain was `started_at DESC NULLS LAST` alone. Both constraint
types are written inside the SAME projection transaction, so `started_at`
ties to the second on every multi-blocked order. The chain was not total —
Postgres returned whichever row the plan produced. The elected constraint,
its bucket, its CTA and its decision join were all plan-dependent.

Second defect: the card showed the elected constraint only. An operator
resolving it saw no movement, because the other blocker was never surfaced.
Same failure shape as the Shopify reviewer rejection (ref 102766) — an
action that appears to work and produces nothing.

## Evidence (local shop 1, all rows `write_source=orderConstraintProjection`)

    customer   11 rows / 11 orders / target_id NULL on all
    inventory  21 rows / 17 orders / target_id set on all
    customer only 2 | inventory only 8 | BOTH 9 | distinct 19

Every multi-blocked order had identical `started_at` across types.

## Fix

Election precedence, total chain:

    operational  post-release pick exception (BL-01b) — the exception state
    customer     merchant-actionable today, no lead time
    inventory    may clear on its own via inbound PO
    then started_at DESC NULLS LAST, then constraint_id

`constraint_id` is the final total key — without it the chain still ties.

Aggregate `other_blocker_types`: active constraint types on the order minus
the elected one, grouped per order so the join stays 1:1 (no fan-out).
Aggregated by TYPE not by row — inventory is line-scoped, but an order
short on three lines is one blocker to an operator.
`COALESCE(..., ARRAY[]::text[])` — never null.

Card renders `Also: <labels>` from `CONSTRAINT_LABELS`. Named, not counted:
"+1 more" gives a number; "Also: Out of Stock" prevents a wasted action.

## Design decisions held

- `DISTINCT ON` retained. The elected row still drives bucket, CTA and the
  decision join — the 2026-07-02 fan-out fix at :95-112 is untouched.
- Buckets stay mutually exclusive. Header, chips and bucket totals unchanged.
- Elected type stripped in the select, not the aggregate — `obt` is grouped
  before the `DISTINCT ON` result is known.

## Verified

    before   customer 8  / inventory 11
    after    customer 11 / inventory 8   (3 consecutive calls, stable)
    total 19, multi 9, single 10, self-leak [] , no fan-out
    UI: OUT OF STOCK 8, ADDRESS ISSUE 11, "Also: Out of Stock" on 9 cards
    header 19 blocked, chip blocked·unbatched 19 — both unchanged

## Not in scope

`FLOW-MULTIBLOCK-02` — resolving a secondary blocker from the card.
Today it is named but actionable only via the detail modal.

`FE-TSC-BASELINE-01` (P2) — `tsc -p apps/frontend` carries 19 standing
errors (MUI palette augmentation, `virtual:lasyncro-modules`, MUI X
overrides, CashFlowResponse drift). It cannot gate anything until cleared;
per-file grep is the only usable signal.
