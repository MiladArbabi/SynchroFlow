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

  /**
   * RECONCILIATION COMPLETENESS GUARD (CRITICAL)
   * -------------------------------------------
   * Checkpoint must ONLY advance if:
   * - Risk snapshot exists for (orderId, aggregateVersion)
   * - ≥1 decision exists for (orderId, aggregateVersion)
   *
   * Prevents false "processed" states.
   */

  // 1. Validate snapshot exists
  const snapshot = await trx('order_risk_snapshot')
    .where({
      order_id: orderId,
      aggregate_version: aggregateVersion
    })
    .first();

  if (!snapshot) {
    throw new Error(
      `[CHECKPOINT_BLOCKED] Missing risk snapshot for order=${orderId} version=${aggregateVersion}`
    );
  }

  /**
   * SOURCE OF TRUTH SHIFT (CRITICAL)
   * --------------------------------
   * aggregate_version is now a first-class column.
   *
   * DO NOT use JSON signals for version lookup.
   * Ensures:
   * - index usage
   * - deterministic correctness
   */
  // 2. Validate at least one decision exists
  const decisionExists = await trx('decisions')
    .where({
      entity_id: orderId,
      aggregate_version: aggregateVersion
    })
    .first();

  if (!decisionExists) {
    throw new Error(
      `[CHECKPOINT_BLOCKED] Missing decision for order=${orderId} version=${aggregateVersion}`
    );
  }

  // 3. Monotonic guard (no regression)
  const current = await trx('orders')
    .where({ lasyncro_order_id: orderId })
    .select('last_projected_version')
    .first();

  if (current && aggregateVersion <= current.last_projected_version) {
    throw new Error(
      `[CHECKPOINT_BLOCKED] Non-monotonic update attempt order=${orderId} new=${aggregateVersion} current=${current.last_projected_version}`
    );
  }

  // 4. Safe update
  await trx('orders')
    .where({ lasyncro_order_id: orderId })
    .update({
      last_projected_version: aggregateVersion
    });

  /**
   * OBSERVABILITY (CRITICAL)
   */
  console.info(
    `[CHECKPOINT_COMMITTED] order=${orderId} version=${aggregateVersion}`
  );
}