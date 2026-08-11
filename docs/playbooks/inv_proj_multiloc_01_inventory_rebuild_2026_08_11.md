# INV-PROJ-MULTILOC-01 — Multi-location inventory projection replay

**Date:** 2026-08-11 · **File:** `apps/backend/src/services/inventory/rebuildInventoryProjection.ts`

## Symptom

A Shopify inventory reconciliation event triggered
`rebuildInventoryProjectionForVariants()` for a variant whose physical WMS stock
was already stowed across two pick bins:

- `A-1` → 1 unit
- `C-4` → 1 unit

The append-only movement ledger still contained both bin-level
`location_transfer` credits and both `inventory_units` remained stowed in their
correct locations, but `inventory_truth` was rebuilt to a single
`WH-1-ROOT` row.

The projection therefore contradicted both the physical LSU state and the
location-level movement ledger.

## Root cause — two compounding defects

1. **Multi-location aggregation was collapsed back to one row per variant.**
   The rebuild query correctly grouped `inventory_movements` by
   `shop_id + lasyncro_variant_id + location_code`, producing independent rows
   for warehouse root and each physical bin.

   The grouped rows were then inserted into a `Map` keyed only by
   `lasyncro_variant_id`.

   Every additional location for the same variant overwrote the previous row,
   so only one location survived when `inventory_truth` was reconstructed.

2. **`location_transfer` was excluded from on-hand replay.**
   Stow records physical movement as a signed pair:

   - source location → negative `location_transfer`
   - destination location → positive `location_transfer`

   The rebuild's on-hand CASE did not include `location_transfer`, so even
   without the variant-only Map collapse the replay could not reconstruct
   stock moved from warehouse root into bins.

## Fix

`rebuildInventoryProjectionForVariants()` now:

- includes signed `location_transfer` movements in on-hand aggregation;
- converts every grouped ledger row into its own `inventory_truth` row;
- preserves location identity for every
  `(shop_id, lasyncro_variant_id, location_code)` tuple;
- retains the existing `WH-{shopId}-ROOT` zero fallback only for requested
  variants with no ledger rows at all.

No inventory movement history is rewritten, deleted, or synthesized by the
rebuild.

## Verification

Runtime verification used the repository's canonical RLS tenant contract via
`withTenant(shopId, ...)`, which establishes:

    app.current_tenant = shopId

The fixture ledger before replay contained:

    A-1
      location_transfer          +1

    C-4
      location_transfer          +1

    WH-1-ROOT
      inbound_purchase           +2
      sale                       -2
      opening_balance             0
      reconciliation_correction  -4
      location_transfer          -2

After the patched deterministic rebuild:

    location     expected on_hand    actual on_hand    result
    A-1                 +1                 +1           PASS
    C-4                 +1                 +1           PASS
    WH-1-ROOT            -6                 -6           PASS

`inventory_truth` therefore contained all three locations simultaneously:

    A-1         on_hand=1   reserved=0   available=1   sellable=1
    C-4         on_hand=1   reserved=0   available=1   sellable=1
    WH-1-ROOT   on_hand=-6  reserved=0   available=0   sellable=0

The two physical LSUs were unchanged:

    LSU-d03540ce   stowed   A-1
    LSU-c1cb0199   stowed   C-4

The variant's `inventory_movements` count remained `10` before and after the
rebuild, proving the verification reconstructed the read model without adding
or mutating ledger history.

The negative warehouse-root balance is not caused by this fix. It reflects
separate already-observed Shopify reconciliation and pre-pick sale semantics
and is intentionally left outside this issue.

## RLS verification note

A first standalone verification attempt failed correctly with:

    new row violates row-level security policy for table "inventory_truth"

because the direct transaction did not establish `app.current_tenant`.

The successful verification reused the repository-standard `withTenant()`
transaction wrapper. Projection verification must not bypass RLS merely to make
a test succeed.

## Durable invariant

A deterministic inventory projection rebuild must preserve every physical
location represented by the append-only ledger.

For each affected variant, replay identity is:

    shop_id + lasyncro_variant_id + location_code

not variant ID alone.

`location_transfer` is part of physical on-hand history and must be replayed
with its stored sign at both source and destination.

## Not fixed here

The following findings remain separately scoped and must not be folded into
INV-PROJ-MULTILOC-01:

- **P0 — SHOPIFY-RECEIVE-INV-SYNC-01:** accepted PO receipt must update the
  corresponding Shopify inventory level at the correctly mapped Shopify
  location. Open; not yet audited.
- **P0 — BILLING-DOWNGRADE-01:** Shopify billing reconciliation unexpectedly
  downgraded shop 1 from Growth/Scale entitlements to Starter after a
  `shopifyStatus='canceled'` state was applied. Open; requires dedicated
  billing-state audit.
- **SHOPIFY-LOCATION-MAP-01:** local WMS bins such as A-1/C-4 currently lack
  verified Shopify external-location mapping.
- **SHOPIFY-WEBHOOK-DUP-01:** equivalent Shopify inventory payloads delivered
  under distinct webhook event IDs can create repeated reconciliation
  corrections.
- **INV-SALE-TIMING-01:** order/revenue reconciliation writes a root-level
  `sale` movement before physical warehouse pick execution.
