import { Knex } from 'knex';
import crypto from 'crypto';
import { logConflictIgnored } from '../conflict-resolution/conflict.logger.js';

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

  // OBSERVABILITY: log intent before conflict-ignore write
  logConflictIgnored({
    entity: 'order_fulfillment_status',
    conflictKey: 'lasyncro_order_id',
    note: 'Insert with ignore() — potential silent drop'
  });

  await trx('order_fulfillment_status')
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
    .ignore();
}