import db from '@lasyncro/backend-core/db.js';
import { computeShopOperationalSnapshot } from './shopOperationalSnapshot.worker.js';

/**
 * HISTORICAL SHOP SNAPSHOT BACKFILL
 * ---------------------------------
 * Reconstructs operational snapshots for the full
 * historical order timeline after initial Shopify sync.
 *
 * Purpose:
 * - Populate Operational Pressure chart immediately
 * - Generate deterministic operational history
 *
 * Execution rules:
 * - Runs ONCE after initial sync
 * - Deterministic reconstruction
 * - Idempotent via (shop_id, snapshot_date) PK merge
 */
export async function backfillShopOperationalSnapshots(shopId: number) {

  console.info('[shop-snapshot-backfill] started', { shopId });

  /**
   * AGGREGATION FIX (CRITICAL)
   * --------------------------
   * Use knex aggregation helpers correctly.
   *
   * db.min/db.max MUST NOT be passed into select()
   * as they produce nested query builders → invalid SQL.
   *
   * Correct usage:
   * - chain .min() / .max() directly on query builder
   */
  const bounds = await db('orders')
    .where({ shop_id: shopId })
    .min('order_created_at as min')
    .max('order_created_at as max')
    .first();

  console.debug('[SNAPSHOT_BACKFILL_BOUNDS_QUERY_RESULT]', {
    shopId,
    bounds,
  });

  if (!bounds?.min || !bounds?.max) {
    console.warn('[shop-snapshot-backfill] skipped — no orders', { shopId });
    return;
  }

  const start = new Date(bounds.min);
  /**
   * BACKFILL UPPER BOUND
   * --------------------
   * Using MAX(order_created_at) is unsafe because ingestion
   * may still be running when backfill begins.
   *
   * Therefore we extend the reconstruction window to NOW.
   * Historical queries remain correct because the snapshot
   * worker enforces:
   *
   *   order_created_at <= snapshotCutoff
   */
  const end = new Date();

  /**
   * BACKFILL BOUNDS VISIBILITY
   * --------------------------
   * Emit the exact historical range used for snapshot reconstruction.
   * This prevents silent truncation when ingestion is still ongoing.
   */
  console.info('[shop-snapshot-backfill] bounds', {
    shopId,
    min: bounds.min,
    max: bounds.max
  });

  /**
   * Normalize to midnight
   */
  start.setUTCHours(0,0,0,0);
  end.setUTCHours(0,0,0,0);

  let cursor = new Date(start);

  let days = 0;

  while (cursor <= end) {
    /* console.info('[shop-snapshot-backfill] iteration', {
      shopId,
      snapshot_date: cursor.toISOString().split('T')[0]
    }); */

    await computeShopOperationalSnapshot(
      String(shopId),
      new Date(cursor),
      { allowMutation: true }
    );

    cursor.setUTCDate(cursor.getUTCDate() + 1);
    days++;
  }

  console.info('[shop-snapshot-backfill] completed', {
    shopId,
    generated_days: days
  });
}