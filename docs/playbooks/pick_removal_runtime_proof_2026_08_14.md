# PICK-REMOVAL-RUNTIME-01 — the first pick_removal row

**Date:** 2026-08-14
**Closes:** the last open loop on `INV-SALE-DOUBLE-01`
**Fixture:** shop 2, batch `13f45382-f162-473e-8faa-d137e0a31dcb`

## Why this cycle existed

Migration 0147 added `pick_removal` and widened `inventory_movement_sign_check`,
and `pickScan.service.ts` writes it — but NO ROW OF THAT TYPE HAD EVER EXISTED.
Every prior validation simulated the on-hand CASE against pre-existing data.

An unproven insert against a live CHECK constraint surfaces as a **500 mid-scan
for an operator on the floor** — the exact failure class the reviewer rehearsal
exists to catch. Hence: through the operator UI, not curl.

## Fixture construction

Shop 2's five seeded orders were all inside a `pick_complete` batch, so the pool
returned `ALL_ELIGIBLE_ORDERS_ALREADY_BATCHED` and nothing was releasable.

`apps/backend/src/scripts/add-one-order.ts` adds ONE order via
`syncShopifyOrders`, which emits domain events only ("responsible ONLY for
transforming Shopify orders → domain events") and writes no inventory.

**Do NOT re-run `seed_fresh_install` for this.** It is idempotent on orders
(`external_event_id`) but NOT on inventory — a second run writes another
`opening_balance` set and inflates stock by 125, destroying the only tenant
whose ledger reconciles with truth.

Order shape deliberately minimal: MCS-001, ONE line, ONE unit — so the
resulting movement is unambiguous. The seeded orders used split allocations,
which made earlier ledger arithmetic harder to read than necessary.

### Gotcha in seed_fresh_install's PRODUCTS

The array is 0-indexed but each entry carries its own `n`, and `orderEdge()`
selects by ARRAY INDEX (`PRODUCTS[o.p]`) while building ids from `product.n`:

    index 0 → n=1  MCS-001  Merino Crew Sweater   79.00
    index 1 → n=2  CWB-002  Canvas Weekender Bag 129.00
    index 2 → n=3  WBE-003  Wool Beanie           29.00

Conflating the two pairs a variant id with the wrong price.

## Result — every assertion held

    row 525cc3f8   pick_removal · order_line_item · pick_scan
                   quantity_delta -1 · operator_id 3 · scan_source manual
    census         pick_removal · 1 row · -1   ← first in the system's history
    truth 115 · ledger 115 · drift 0
    MCS-001        37 → 36

The insert passed the new sign-check arm. `pick_removal` was correctly excluded
from on-hand: `125 - 10 - 9 + 9 = 115`, matching truth exactly.

Reservations moved coherently: hold 3→4 rows, release 5→6, still netting 0.

`operator_id` and `scan_source` are both populated, so the three readers
retargeted in the C-1 commit (`wmsAnalytics:238`, `:677`,
`members.controller:602`) will find it.

**The INV-SALE-DOUBLE-01 chain is now proven end to end at runtime:** migration
→ write → on-hand exclusion → backfill → truth and ledger agree after a real
pick, on a tenant built through the real pipeline.

## Also verified live

`REBUILD-ADVICE-01`'s corrected remediation appeared in the running worker log,
not just in source:

    remediation: 'Margin snapshot drift. Recompute margin only: npm run
    backfill:margin ... Do NOT run rebuild-from-events: it truncates and
    replays all projection tables ...'

## New findings

### INV-INGEST-TRUTH-01 (P1) — verified

**Final invariant: economic order ingestion and physical inventory movement are
separate concerns.**

An ingested Shopify order still writes its economic `sale` movement, but that
movement does **not** debit `inventory_truth`. Physical truth changes only when
stock actually leaves the warehouse:

- order ingestion: `sale` — economic only; no physical truth mutation
- batch release: `reservation_hold` — on-hand unchanged, reserved increases,
  available decreases
- confirmed WMS pick: `pick_removal` — on-hand and reserved decrease,
  available stays unchanged
- Shopify fulfillment without a corresponding completed pick:
  `fulfillment_removal` — physical fallback debit for only the remaining
  unpicked quantity
- fulfillment after a completed pick: no second physical debit
- duplicate fulfillment: no second physical debit
- missing physical location: `LOCATION_NOT_FOUND`; no mutation
- multiple eligible physical locations: `LOCATION_AMBIGUOUS`; no guessing and
  no mutation

Migration 0148 adds the `fulfillment_removal` inventory movement type.
`orders.fulfilled.ts` invokes the physical fallback only for normalized
`fulfilled` state.

Runtime verification on fresh shop 2 proved the complete sequence:

    path                              before       after
    ingestion sale                   125/0/125    125/0/125
    release MCS-001                  40/0/40      40/1/39
    pick MCS-001                     40/1/39      39/0/39
    unreserved fulfillment CWB-002   25/0/25      24/0/24
    reserved fulfillment WBE-003     60/2/58      58/0/58
    picked then fulfilled MCS-001    39/0/39      39/0/39

The released-but-unpicked fulfillment wrote:

    reservation_hold       +2
    reservation_release    -2
    fulfillment_removal    -2

The fully picked fulfillment retained only its existing:

    pick_removal           -1

A repeated fulfillment left truth unchanged and kept exactly one
`fulfillment_removal` row.

The shipped-line pick guard also prevents a later pick from creating another
physical debit. The API maps that stale pick attempt to HTTP 409.

### Rebuild compatibility

`rebuildInventoryProjectionForVariants` now reconstructs physical on-hand from
physical movements rather than treating every `sale` as physical.

Compatibility rules preserve historical correctness:

- legacy pre-0147 `sale` rows with `triggered_by='pick_scan'` remain physical
- ordinary ingestion `sale` rows remain economic-only
- `inv_sale_backfill_01` reconciliation compensators are physically neutral
- `canonical_repair` reconciliation compensators are physically neutral
- ordinary reconciliation corrections remain physical
- `pick_removal` and `fulfillment_removal` are physical debits

Rollback rebuild verification reproduced the persistent shop-2 truth exactly:

    CWB-002   24 / 0 / 24
    MCS-001   39 / 0 / 39
    WBE-003   58 / 0 / 58

This supersedes the earlier conclusion that ingestion-only ledger totals
reproduced physical truth. They merely coincided in the earlier fixture because
truth had already been mutated directly by historical pick processing.

### SESSION-ORDERFLOW-LOGOUT-01 (P2)

Order Flow bounces to `/login` in an incognito session; `/wms` and `/orders` do
not. Caught mid-redirect: the page renders, then the URL is `/login`.

No 401 reproduced. Eight candidate endpoints all returned 200 with the same
token (`/orders/constrained`, `/wms/order-pool`, `/wms/batches`,
`/orders/fulfilled`, `/alerts`, `/lifecycle`; two guessed paths 404'd).

Hypothesis unconfirmed: some request 401s and `axiosConfig`'s interceptor
attempts a silent refresh, which cannot succeed in incognito (no refresh
cookie) and logs out. A real merchant whose token expires on Order Flow would
be bounced to login mid-triage.

## Session-injection recipe (for future UI verification)

Shop 2's owner is a ghost user with an install-generated password nobody holds,
so the browser cannot log in. Mint a token and inject it:

1. `node -e "...jwt.sign({... user_id, shop_id, shop_roles:['owner'] ...})"`
2. **Incognito window** — a normal window carries shop 1's refresh cookie, and
   any 401 silently swaps the injected token for a shop 1 one.
3. Console: `localStorage.setItem('accessToken', ...)` and
   `localStorage.setItem('user', JSON.stringify({...}))`, then reload.

`authStore.ts` caches the token in memory but falls back to `localStorage` on
first read, so injection survives the reload. Mint with a generous TTL — an
expired token in incognito lands on `/login` with no way back.
