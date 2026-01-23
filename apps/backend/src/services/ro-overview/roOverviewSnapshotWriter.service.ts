import db from 'api-src/db';
import { FT2EvaluatorService } from '../ft2-evaluator.service';
import { getOrderNexusFt2Snapshot } from '../order-nexus-ft2/orderNexusFt2.resolver';

/**
 * RO Overview Snapshot Writer
 * ---------------------------
 * Authoritative write-only service.
 * Triggered after FT2 latch.
 *
 * Rules:
 * - Trust evaluated first
 * - Orders queried only if Trust allows
 * - No interpretation
 * - No recomputation-on-read
 */
export async function writeROOverviewSnapshot(shopId: number): Promise<void> {
  const evaluation = await FT2EvaluatorService.evaluate(shopId);

  // Trust collapsed or FT2 blocked
  if (!evaluation.eligible) {
    await db('ro_overview_snapshots').insert({
      shop_id: shopId,
      trust_snapshot: null,
      domains_snapshot: {},
      snapshot_at: new Date(),
      created_at: new Date(),
    });
    return;
  }

  // Trust present — Phase 1 RO mirrors Trust + Orders FT2
    const ordersSnapshot = await getOrderNexusFt2Snapshot({
        shopId,
        range: 'past_30_days',
    });

    await db('ro_overview_snapshots').insert({
    shop_id: shopId,
    trust_snapshot: evaluation,
    domains_snapshot: {
        orders: ordersSnapshot,
    },
    snapshot_at: new Date(),
    created_at: new Date(),
    });
}