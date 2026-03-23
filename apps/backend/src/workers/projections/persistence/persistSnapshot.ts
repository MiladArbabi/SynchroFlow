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
    .onConflict(['shop_id', 'snapshot_date'])
    .ignore();

  if ((result as any)?.rowCount === 0) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'SNAPSHOT_WRITE_SKIPPED_DUPLICATE',
        data: { shopId, snapshotDate: snapshotDateNormalized },
      })
    );
  }
}