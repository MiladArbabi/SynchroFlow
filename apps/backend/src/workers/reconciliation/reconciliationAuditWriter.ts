import { Knex } from 'knex';

/**
 * RECONCILIATION AUDIT WRITER
 * ===========================
 *
 * NOT A PROJECTION.
 *
 * Writes reconciliation execution audit entries.
 *
 * This module:
 * - does not maintain projection state
 * - does not participate in deterministic rebuild
 * - must not be registered in projection safety systems
 */
export async function writeReconciliationAudit(
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