import { Knex } from 'knex';

/**
 * RECONCILIATION AUDIT PROJECTION
 * --------------------------------
 * Records successful reconciliation projection execution.
 *
 * Guarantees:
 * - append-only log
 * - deterministic replay
 */

export async function projectReconciliationAudit(
  trx: Knex.Transaction,
  orderId: string,
  aggregateVersion: number
) {

  await trx('order_projection_audit_log')
    .insert({
      lasyncro_order_id: orderId,
      aggregate_version: aggregateVersion,
      source: 'reconciliation_worker'
    });
}