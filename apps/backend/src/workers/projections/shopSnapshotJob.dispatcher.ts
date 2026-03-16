import db from '@lasyncro/backend-core/db.js';
import { computeShopOperationalSnapshot } from './shopOperationalSnapshot.worker.js';

/**
 * SHOP SNAPSHOT JOB DISPATCHER
 * -----------------------------
 * Consumes scheduled snapshot jobs and executes
 * Control Tower snapshot recomputation.
 *
 * Guarantees:
 * - one snapshot job per shop
 * - deterministic recomputation
 * - worker isolation from reconciliation pipeline
 */
export async function startShopSnapshotJobDispatcher() {

  console.log('[snapshot-dispatcher] started');

  setInterval(async () => {

    const jobs = await db('shop_snapshot_jobs')
      .select('shop_id')
      .limit(20);

    for (const job of jobs) {

      try {

        await computeShopOperationalSnapshot(job.shop_id);

        await db('shop_snapshot_jobs')
          .where({ shop_id: job.shop_id })
          .delete();

        console.info('[snapshot-dispatcher] snapshot completed', {
          shopId: job.shop_id
        });

      } catch (err) {

        console.error('[snapshot-dispatcher] snapshot failed', {
          shopId: job.shop_id,
          error: err instanceof Error ? err.message : err
        });

      }

    }

  }, 2000); // poll every 2 seconds

}