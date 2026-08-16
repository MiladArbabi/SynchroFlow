import type { Knex } from 'knex';

/**
 * FRESH-STOW-CLIFF-01 — CANONICAL PICKABLE-LOCATION PREDICATE
 * -----------------------------------------------------------
 * Pickable stock is real, sellable stock in an active location that is
 * not a staging or exception zone. Two kinds qualify, always:
 *
 *   - active pick bins  (stowed stock)
 *   - the warehouse root (received-but-unstowed bulk stock)
 *
 * Staging and exception zones (receive, returns, pack, ship, kitting,
 * problem, quarantine) hold real stock that is NOT sellable-from and
 * stay excluded: a returned unit must be inspected before it is sellable.
 *
 * WHY THE BIN-EXISTENCE CONDITIONAL WAS REMOVED
 * hasActivePickBins() was tenant-wide and binary, so creating one empty
 * pick bin revoked the root fallback and stripped 100% of availability
 * from a tenant that had stowed nothing. Reproduced on shop 2: 121 units
 * across 3 variants -> 0 pickable after a single empty-bin insert, with
 * the order pool still reporting both orders ready. That is the shape a
 * Shopify reviewer creates by installing, syncing, and then opening
 * Floor Planning (which the Overview deep-links to) before stowing.
 * It also broke partial stow: 50 units binned and 150 in bulk at root
 * made the 150 invisible, which is normal high-SKU SMB operation and
 * normal for a merchant running laSyncro alongside legacy manual flow.
 *
 * Unstowed stock is a STOW TASK in the UI, never fake unavailability.
 * Inventory stays mathematically honest: 36 units at root are 36 units.
 *
 * Stowed stock is still consumed first — batchReservation orders by
 * location_rank (bin = 0, root = 1), so this changes what is visible,
 * not what is preferred.
 *
 * Both the constraint evaluator (what is eligible) and batch reservation
 * (what is reservable) MUST use this helper. It now takes no state, so
 * the two sides cannot diverge on timing either.
 */
export function pickableLocationCondition(
  trx: Knex | Knex.Transaction
): Knex.Raw {
  return trx.raw(
    `((wl.zone_type = 'pick' AND wl.type = 'bin') OR wl.type = 'warehouse')`
  );
}

/**
 * Retained for onboarding/floor-planning UI state ("does this tenant
 * have bins yet"). No longer participates in availability — see above.
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