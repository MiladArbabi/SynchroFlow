import { Knex } from 'knex';

/**
 * RECONCILIATION CHECKPOINT WRITER
 * ================================
 *
 * NOT A PROJECTION.
 *
 * Maintains the last processed aggregate version
 * for reconciliation idempotency.
 *
 * Writes control-plane state only.
 *
 * This module must NOT be registered in the
 * projection safety system.
 */

export async function writeReconciliationCheckpoint(
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