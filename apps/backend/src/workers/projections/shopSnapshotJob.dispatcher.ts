import { systemDb } from '@lasyncro/backend-core/db.js';
import { computeShopOperationalSnapshot } from './shopOperationalSnapshot.worker.js';
import { aggregateAlertsForShop } from '../../services/alerts/alerts.aggregator.js';

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

  /**
   * LOGGING: structured + centralized-ready
   * Replaceable with real logger without changing call sites
   */
  const log = (message: string, meta?: Record<string, unknown>) => {
    process.stdout.write(
      JSON.stringify({
        level: 'info',
        context: 'snapshot-dispatcher',
        message,
        ...(meta ?? {}),
        timestamp: new Date().toISOString(),
      }) + '\n'
    );
  };

  log('started');

  setInterval(async () => {

    /**
     * PROJECTION CATCHUP DELAY (CRITICAL)
     * -------------------------------------
     * Snapshot jobs are scheduled during projection processing.
     * If consumed immediately, the snapshot captures partial state
     * (e.g. orders not yet paid/fulfilled) producing inflated
     * constrained_orders and incorrect revenue figures.
     *
     * Wait 10 seconds after scheduling before processing,
     * giving the projection worker time to catch up.
     */
    const jobs = await systemDb('shop_snapshot_jobs')
      .select('shop_id')
      .where('scheduled_at', '<=', systemDb.raw(`NOW() - INTERVAL '2 seconds'`))
      .limit(20);

    for (const job of jobs) {

      try {
        await computeShopOperationalSnapshot(String(job.shop_id));
        /**
         * ALERTS AGGREGATION
         * --------------------------
         * Runs after every snapshot recomputation.
         * Upserts ranked operator alerts from constraint,
         * SLA, and revenue signals.
         */
        await aggregateAlertsForShop(job.shop_id);
        /**
         * DAILY OPERATIONAL BRIEF (DEV-08 FIX)
         * --------------------------------------
         * projectDailyOperationalBrief was fully declared in
         * projectionContracts/projectionDependencies/projectionExecutionOrder
         * but never dispatched anywhere — daily_operational_brief_snapshot
         * stayed empty regardless of seed/rebuild order. This is the one
         * canonical per-shop snapshot pipeline (reconciliation -> here),
         * so it belongs alongside its two siblings above, not in rebuild
         * (rebuild is intentionally pure / no bulk recompute, see its
         * own header comment) and not as a separate cron job.
         *
         * aggregateVersion is accepted by the function signature but
         * unused in its body — passing 0 is safe, not a placeholder hack.
         */
        await systemDb.transaction(async (trx) => {
          await trx.raw(`SET LOCAL "app.current_tenant" = '${job.shop_id}'`);
          const { projectDailyOperationalBrief } = await import('../../projections/dailyOperationalBriefProjection.js');
          await projectDailyOperationalBrief(trx, String(job.shop_id), 0, new Date());
        });
        
        await systemDb('shop_snapshot_jobs')
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