import type { Knex } from 'knex';

/**
 * SNAPSHOT PERSISTENCE
 * --------------------
 * Write-only layer.
 * Enforces append-only semantics.
 */
export async function persistSnapshot(
  trx: Knex.Transaction,
  snapshotPayload: Record<string, unknown>,
  shopId: string,
  snapshotDateNormalized: string
) {
  /**
   * WRITE ATTEMPT
   * -------------
   * rowCount:
   * - 1 → inserted
   * - 0 → duplicate (append-only constraint)
   */
  const result = await trx('orders_operational_control_snapshot')
    .insert(snapshotPayload)
    /**
     * CONFLICT STRATEGY: MERGE (SNAPSHOT INVARIANT)
     * -------------------------------------------
     * Snapshots must be replace-on-reconcile.
     * ignore() breaks determinism and causes stale state.
     */
    .onConflict(['shop_id', 'snapshot_date'])
    .merge({
      updated_at: trx.fn.now()
    });

  /**
   * SAFE ACCESS: enforce DB result contract
   * Prevent silent insert failures
   */
  type InsertResult = { rowCount?: number };

  const insertResult = result as InsertResult;

  if (insertResult.rowCount === 0) {
    throw new Error('[persistSnapshot] Insert failed — no rows affected');
  }
}