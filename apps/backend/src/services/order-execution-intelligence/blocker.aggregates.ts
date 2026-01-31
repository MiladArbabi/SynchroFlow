import { BlockedRevenueClassification } from './blockedRevenue.classification';
import db from 'api-src/db';

type ExecutionRow = {
  order_id: string;        // platform order id
  status: 'processing' | 'in_transit' | 'delivered' | 'cancelled';
  revenue: number;
};

/**
 * aggregateBlockedRevenue (L2 → L1 downgrade helper)
 * -------------------------------------------------
 * Produces magnitude-only blocked revenue totals.
 *
 * Source of truth:
 * - classifyBlockedRevenue (execution-aware, expressive)
 *
 * Guarantees:
 * - No reclassification
 * - No execution inference
 * - No semantic drift
 */
export async function aggregateBlockedRevenue(
  shopId: number
): Promise<{
  totalBlocked: number;
  byCategory: Record<string, number>;
}> {
  const classification = await classifyBlockedRevenue(shopId);

  /**
   * IMPORTANT:
   * ----------
   * This function is allowed to return partial truth.
   * FT2 gating happens later via FTEP.
   */

  const totalBlocked = classification.totalBlockedValue;

  const byCategory =
    classification.buckets && Object.keys(classification.buckets).length > 0
      ? classification.buckets
      : {};

  // DEV sanity only — never enforce here
  if (process.env.NODE_ENV !== 'production') {
    const sum = Object.values(byCategory).reduce(
      (a, b) => a + b,
      0
    );

    if (sum > totalBlocked) {
      console.warn(
        '[L2:blocker][aggregate] Bucket sum exceeds totalBlocked',
        { totalBlocked, sum, byCategory }
      );
    }
  }

  return { totalBlocked, byCategory };
}

/**
 * Aggregate blocked revenue by obligation category.
 *
 * Rules:
 * - Must account for 100% of blocked value or fail
 * - No best-effort math
 */
export async function classifyBlockedRevenue(
  shopId: number
): Promise<BlockedRevenueClassification> {
  /**
   * IMPORTANT:
   * ----------
   * This classifier reads ONLY from order_fulfillment_status.
   * Missing execution rows are impossible by contract.
   * Synthetic execution is first-class truth.
   */

  const rows: ExecutionRow[] = await db('order_fulfillment_status as ofs')
  .join(
    'canonical_orders as o',
    function () {
      this.on('o.platform_order_id', '=', 'ofs.order_id')
        .andOn('o.shop_id', '=', 'ofs.shop_id');
    }
  )
  .where('o.shop_id', shopId)
  .whereNotIn('ofs.status', ['delivered'])
  .select(
    'ofs.order_id',
    'ofs.status',
    'o.total_price as revenue'
  );

  let totalBlockedValue = 0;
  let unknownValue = 0;

  for (const row of rows) {
    totalBlockedValue += row.revenue;

    // No obligation signal exists yet → epistemically unknown
    unknownValue += row.revenue;
  }

  return {
    totalBlockedValue,
    buckets: {}, // no categories yet
    coverage: {
      classifiedPct: 0,
      unknownValue,
    },
  };
};