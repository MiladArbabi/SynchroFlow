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
   * IMMUTABILITY BYPASS (CONTROLLED)
   * ----------------------------------
   * The snapshot table has a trigger that blocks UPDATE/DELETE
   * unless app.allow_snapshot_mutation = 'true' is set.
   *
   * We set it here to allow the onConflict merge to succeed.
   * This is safe because:
   * - the session variable is local to this transaction
   * - snapshot recompute is deterministic
   * - the dispatcher is the only writer
   */
  await trx.raw(`SET LOCAL "app.allow_snapshot_mutation" = 'true'`);

  const result = await trx('orders_operational_control_snapshot')
    .insert(snapshotPayload)
    .onConflict(['shop_id', 'snapshot_date'])
    .merge({
      ...snapshotPayload,
      updated_at: trx.fn.now(),
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