import { Knex } from 'knex';
import crypto from 'crypto';
import { logConflictIgnored } from '../conflict-resolution/conflict.logger.js';
import { ResolutionStrategies } from '../conflict-resolution/conflict.types.js';

/**
 * ORDER FULFILLMENT PROJECTION
 * ----------------------------
 * Maintains deterministic baseline fulfillment state.
 *
 * Guarantees:
 * - row always exists
 * - event-time anchored timestamps
 * - deterministic ID generation
 */

function deterministicId(
  entity: string,
  orderId: string,
  aggregateVersion: number
): string {
  return crypto
    .createHash('sha256')
    .update(`${entity}:${orderId}:${aggregateVersion}`)
    .digest('hex')
    .slice(0, 32);
}

export async function projectOrderFulfillment(
  trx: Knex.Transaction,
  orderId: string,
  aggregateVersion: number,
  eventAnchor: Date
) {

  console.log('[CONFLICT_STRATEGY]', {
    entity: 'order_fulfillment_status',
    strategy: ResolutionStrategies.MERGE
  });

  await trx('order_fulfillment_status')
  /**
   * CONFLICT STRATEGY: MERGE (DETERMINISTIC)
   * ---------------------------------------
   * This projection uses ON CONFLICT DO UPDATE.
   *
   * Guarantees:
   * - no silent drops
   * - idempotent replay
   * - last-write-wins based on event order
   */
    .insert({
      lasyncro_fulfillment_id: deterministicId(
        'order_fulfillment_status',
        orderId,
        aggregateVersion
      ),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: eventAnchor,
      created_at: eventAnchor,
      updated_at: eventAnchor
    })
    .onConflict('lasyncro_order_id')
    /**
     * CONFLICT RESOLUTION: DETERMINISTIC OVERWRITE
     * -------------------------------------------
     * ignore() is forbidden in projections because it:
     * - silently drops events
     * - breaks replay determinism
     * - causes state divergence
     *
     * merge() ensures:
     * - last-write-wins (event-ordered)
     * - idempotent replay
     * - full state convergence
     */
    .merge({
      status: 'pending',
      status_updated_at: eventAnchor,
      updated_at: eventAnchor
    });
}