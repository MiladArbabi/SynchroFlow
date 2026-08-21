# Shopify Inventory Observation Contract

Date: 2026-08-13
Issue: SHOPIFY-INV-WEBHOOK-LOOP-01
Status: Implemented

## Purpose

Define the ownership boundary between Shopify inventory observations and
laSyncro physical warehouse inventory.

## Canonical invariant

`inventory_levels/update` is an external Shopify observation.

It MUST NOT:

- create `inventory_movements`
- create `reconciliation_correction` movements
- mutate `inventory_truth`
- rebuild the physical inventory projection
- compare Shopify availability against `WH-{shopId}-ROOT` and convert the
  difference into warehouse stock

Physical warehouse inventory is authoritative in the laSyncro inventory ledger.

## Ingestion contract

Shopify `inventory_levels/update` webhooks remain persisted as domain events for:

- auditability
- replay
- operational visibility
- future drift detection and reconciliation workflows

The webhook therefore records what Shopify reports without interpreting that
observation as a physical warehouse movement.

## Projection contract

Projection handling for `inventory_levels/update` is observation-only.

The projection handler may log that the event was observed, but it MUST NOT call
`rebuildInventoryProjectionForVariants()` or otherwise modify
`inventory_truth`.

## Why this is required

laSyncro inventory is multi-location within a physical warehouse.

For example:

    WH-1-ROOT = 0
    A-1       = 1

    physical warehouse total = 1

Shopify may report:

    available = 1

Comparing Shopify `available=1` only against ROOT `0` would incorrectly infer a
`+1` inventory difference.

If that difference were written as:

    reconciliation_correction +1 @ WH-1-ROOT

laSyncro would then represent:

    WH-1-ROOT = 1
    A-1       = 1

    physical warehouse total = 2

for one physical unit.

The observation-only contract prevents this feedback loop.

## Reconciliation contract

Inventory drift detection is a separate concern from webhook ingestion.

A future reconciliation workflow may compare:

- Shopify availability
- laSyncro expected sellable availability
- warehouse identity
- Shopify Location identity
- variant identity

but detecting drift MUST NOT automatically manufacture physical stock.

Any physical correction must originate from an explicit, traceable warehouse
inventory event or approved reconciliation action.

## Related inventory publication contract

Outbound Shopify inventory synchronization is handled separately.

The approved lifecycle contract is:

- supplier receive accepted and sellable -> Shopify availability changes
- stow inside the same warehouse -> no Shopify inventory change
- bin-to-bin movement -> no Shopify inventory change
- damage / shrinkage / approved adjustment -> publish corresponding effect
- return -> publish only after disposition/origin rules establish the correct
  sellability effect
- inter-warehouse transfer -> location-specific inventory effect

Outbound publication must also account for:

- `warehouse_id`
- Shopify Location mapping
- canonical full Shopify GIDs
- durable retries
- Shopify idempotency requirements
- event origin to prevent double application

### Shopify Location mapping status

**INV-SHOPIFY-LOCATION-10 completed 2026-08-21.**

The durable mapping boundary is the physical laSyncro warehouse:

```text
warehouse_locations.location_code
    → warehouse_locations.warehouse_id
    → warehouses.external_location_id
    → Shopify Location
```

One laSyncro warehouse maps to at most one Shopify Location. A non-null
Shopify Location may belong to only one warehouse within the same shop.

Mapping is explicit in Settings → Warehouse; multiple Shopify Location
candidates are never silently auto-mapped.

This mapping infrastructure does **not** change the observation-only webhook
contract above and does not authorize manufacturing physical stock from a
Shopify observation.

The outbound publication lifecycle remains a separate concern. In particular,
the contract above states that stow inside the same warehouse must not itself
change Shopify inventory; any existing stow-triggered writeback behavior must
be handled under the separate inventory-publication workstream rather than
being treated as part of INV-SHOPIFY-LOCATION-10.

Those concerns are intentionally outside SHOPIFY-INV-WEBHOOK-LOOP-01.