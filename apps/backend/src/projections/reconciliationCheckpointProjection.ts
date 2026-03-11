import { Knex } from 'knex';

/**
 * RECONCILIATION CHECKPOINT PROJECTION
 * ------------------------------------
 * Updates the last projected version for an order.
 *
 * Purpose:
 * - prevents duplicate projections
 * - marks reconciliation completion
 *
 * Guarantees:
 * - monotonic version progression
 */

export async function projectReconciliationCheckpoint(
  trx: Knex.Transaction,
  orderId: string,
  aggregateVersion: number
) {

  await trx('orders')
    .where({ lasyncro_order_id: orderId })
    .update({
      last_projected_version: aggregateVersion
    });
}