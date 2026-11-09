// apps/backend/src/services/wms/stowLocationCapacity.service.ts
//
// SF-STOW-SAD-PATH-01 S1 — opt-in hard capacity guard for Stow placement.
//
// Scope: Stow placement only (confirmStow and its receive_recovery branch).
// Other inventory writers are not covered.
//
// Locking: callers MUST already hold the GH-1305 hierarchy lock
// (lockStowDestinationHierarchy) and have passed destination eligibility.
// Every Stow placement takes that shop-wide lock first, so under READ COMMITTED
// the occupancy read below is fresh and cannot be raced by another Stow
// confirmation. No additional lock is introduced here.
import type { Knex } from 'knex';

export const LOCATION_CAPACITY_EXCEEDED = 'LOCATION_CAPACITY_EXCEEDED' as const;

export class LocationCapacityExceededError extends Error {
  readonly code = LOCATION_CAPACITY_EXCEEDED;
  constructor(
    readonly locationCode: string,
    readonly maxCapacity: number,
    readonly occupiedQuantity: number,
    readonly incomingQuantity: number
  ) {
    super(LOCATION_CAPACITY_EXCEEDED);
  }
}

export async function isLocationCapacityEnforced(trx: Knex.Transaction, shopId: number): Promise<boolean> {
  const row = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .first('enforce_location_capacity');
  return row?.enforce_location_capacity === true;
}

/**
 * Rejects a placement of `incomingQuantity` into `locationCode` when the shop
 * enforces capacity and occupancy + incoming would exceed max_capacity.
 * Occupancy is SUM(inventory_truth.on_hand_quantity) across all variants at the
 * destination, so reserved and unlabelled physical stock count. NULL capacity
 * is unlimited. Read-only: throws before any mutation.
 */
export async function assertStowLocationCapacity(
  trx: Knex.Transaction,
  input: { shopId: number; locationCode: string; incomingQuantity: number; enforced: boolean }
): Promise<void> {
  const { shopId, locationCode, incomingQuantity, enforced } = input;
  if (!enforced || !(incomingQuantity > 0)) return;

  const location = await trx('warehouse_locations')
    .where({ shop_id: shopId, location_code: locationCode })
    .first('max_capacity');
  if (location?.max_capacity == null) return;
  const maxCapacity = Number(location.max_capacity);

  const occupancy = await trx('inventory_truth')
    .where({ shop_id: shopId, location_code: locationCode })
    .sum({ total: 'on_hand_quantity' })
    .first();
  const occupied = Number(occupancy?.total ?? 0);

  if (occupied + incomingQuantity > maxCapacity) {
    throw new LocationCapacityExceededError(locationCode, maxCapacity, occupied, incomingQuantity);
  }
}
