import type { Knex } from 'knex';
import { lockLocationHierarchy } from '../inventory/locationHierarchy.service.js';

export class StowDestinationEligibilityError extends Error {
  constructor(readonly code: 'STOW_DESTINATION_NOT_FOUND' | 'STOW_DESTINATION_INACTIVE' | 'STOW_DESTINATION_STRUCTURAL' | 'STOW_DESTINATION_ISOLATION_UNSUPPORTED') {
    super(code);
  }
}

/** Take before task, location or inventory locks. Child configuration uses the
 * same transaction lock, so eligibility remains valid until placement commits.
 * Waiting must be followed by fresh READ COMMITTED snapshots.
 */
export async function lockStowDestinationHierarchy(trx: Knex.Transaction, shopId: number): Promise<void> {
  const isolation = await trx.raw('SHOW transaction_isolation');
  if (isolation.rows[0].transaction_isolation !== 'read committed') {
    throw new StowDestinationEligibilityError('STOW_DESTINATION_ISOLATION_UNSUPPORTED');
  }
  await lockLocationHierarchy(trx, shopId);
}

/** Also safe for callers without a prior lock; entry points must acquire the
 * hierarchy lock before taking any other locks. Never filter inactive children:
 * disabling a position does not turn its parent back into a placement target.
 */
export async function assertStowDestinationEligible(trx: Knex.Transaction, shopId: number, locationCode: string) {
  await lockStowDestinationHierarchy(trx, shopId);
  const location = await trx('warehouse_locations')
    .where({ shop_id: shopId, location_code: locationCode })
    .forShare()
    .first();
  if (!location) throw new StowDestinationEligibilityError('STOW_DESTINATION_NOT_FOUND');
  if (!location.active) throw new StowDestinationEligibilityError('STOW_DESTINATION_INACTIVE');
  const child = await trx('warehouse_locations')
    .where({ shop_id: shopId, parent_location_code: locationCode })
    .first('location_code');
  if (child) throw new StowDestinationEligibilityError('STOW_DESTINATION_STRUCTURAL');
  return location;
}
