import type { Knex } from 'knex';

/**
 * INV-BLOCK-19 — CANONICAL PICKABLE-LOCATION PREDICATE
 * ----------------------------------------------------
 * Pickable stock is stock that has been stowed into an active pick bin.
 * Staging and exception zones (receive, returns, pack, ship, kitting,
 * problem, quarantine) hold real stock that is NOT sellable-from: a
 * received unit must be stowed, and a returned unit must be inspected
 * and re-stowed, before either becomes pickable.
 *
 * FRESH-INSTALL FALLBACK (SHOP-REV-02, Shopify ref 102766)
 * A tenant at install has one warehouse root and zero bins. Excluding
 * root outright would block every order on such a tenant — the exact
 * defect that produced the App Store rejection. Root therefore counts
 * as pickable ONLY while the tenant has no active pick bin at all.
 * The moment a pick bin exists, root stock is unstowed stock and is
 * correctly excluded (surfacing as a stow task, not as availability).
 *
 * Both the constraint evaluator (what is eligible) and batch reservation
 * (what is reservable) MUST use this helper. Divergence means orders
 * either block with stock on hand or pass eligibility and throw at
 * release. Sharing one definition makes that divergence unreachable.
 */
export async function hasActivePickBins(
  trx: Knex | Knex.Transaction,
  shopId: number
): Promise<boolean> {
  const row = await trx('warehouse_locations')
    .where({
      shop_id: shopId,
      active: true,
      type: 'bin',
      zone_type: 'pick',
    })
    .first('location_code');

  return !!row;
}

/**
 * Returns the location predicate for a join already aliased `wl`.
 * Caller supplies `active` and `shop_id` scoping separately.
 */
export function pickableLocationCondition(
  trx: Knex | Knex.Transaction,
  hasPickBins: boolean
): Knex.Raw {
  return hasPickBins
    ? trx.raw(`(wl.zone_type = 'pick' AND wl.type = 'bin')`)
    : trx.raw(
        `((wl.zone_type = 'pick' AND wl.type = 'bin') OR wl.type = 'warehouse')`
      );
}