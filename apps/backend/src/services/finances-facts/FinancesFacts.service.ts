import db from '@lasyncro/backend-core/db.js';
import type { FinancesFacts } from './FinancesFacts.types.js';

interface BuildFinancesFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * Finances Facts Service
 * ---------------------
 * Sovereign source of raw financial truth.
 * Identity: orders.lasyncro_order_id
 *
 * Rules:
 * - DB access ONLY
 * - No interpretation
 * - No thresholds
 * - No intelligence
 * - Nulls preserved
 */
export async function buildFinancesFacts(
  input: BuildFinancesFactsInput
): Promise<FinancesFacts> {
  const { shopId, period } = input;

  /**
   * Revenue — Gross Order Revenue
    * -----------------------------
    * Source: orders.total_price
    *
    * IMPORTANT:
    * - This represents GROSS order revenue at creation time.
    * - It does NOT reflect:
    *   - Refund executions
    *   - Partial returns
    *   - Revenue unit adjustments
    *
    * This is structurally sovereign,
    * but NOT execution-adjusted revenue.
    */
  const revenueRow = await db('orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', period.from)
    .andWhere('order_created_at', '<=', period.to)
    .sum<{ sum: string | null }>('total_price as sum')
    .first();

  const totalRevenue =
    revenueRow?.sum != null ? Number(revenueRow.sum) : null;

  /**
   * Refunds — Execution-backed financial truth
   * ------------------------------------------
   * Source: refund_executions.total_refund_amount
   *
   * IMPORTANT:
   * - This reflects applied refund executions only
   * - Detached from order creation semantics
   * - Independent of negative order modeling
   */
  const refundRow = await db('refund_executions as r')
    .join('orders as o', 'r.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('r.executed_at', '>=', period.from)
    .andWhere('r.executed_at', '<=', period.to)
    .sum<{ sum: string | null }>('r.total_refund_amount as sum')
    .first();

  /**
   * Refund normalization
   * -------------------
   * `.first()` may return undefined.
   * We normalize to explicit null when no row exists.
   */
  const refundsObserved =
    refundRow == null || refundRow.sum == null
      ? null
      : Number(refundRow.sum);

  /**
   * Costs
   * -----
   * Costs are not yet canonical.
   * No sovereign cost layer exists.
   */
  const totalCosts: number | null = null;

  /**
   * Net Result
   * ----------
   * Costs are not yet canonical.
   * Net financial result is therefore epistemically unavailable.
   */
  const netResult: number | null = null;

  /**
   * Data Coverage — factual only
   * ----------------------------
   * Coverage here answers ONE question:
   * "Did we observe any sovereign orders in this period?"
   *
   * - 0 orders  → null (no evidence)
   * - ≥1 orders → 100 (fully observed)
   */
  const ordersCountRow = await db('orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', period.from)
    .andWhere('order_created_at', '<=', period.to)
    .count<{ count: string }>('lasyncro_order_id as count')
    .first();

  const ordersCount =
  ordersCountRow?.count != null
    ? Number(ordersCountRow.count)
    : null;

  const completenessPct =
    ordersCountRow?.count != null && Number(ordersCountRow.count) > 0
      ? 100
      : null;
  
  /**
   * Time-series (daily buckets)
   * ---------------------------
   * Provides raw financial observations within the period.
   *
   * Rules:
   * - UTC day buckets
   * - No gap filling
   * - No trend inference
   * - Null means "no evidence", NOT zero
   */
  
  const dailyRows = await db('orders')
    .select(
      db.raw(
        `
        date_trunc('day', order_created_at AT TIME ZONE 'UTC') as bucket_day,
        SUM(total_price) as revenue,
        COUNT(lasyncro_order_id) as count
        `
      )
    )
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', period.from)
    .andWhere('order_created_at', '<=', period.to)
    .groupBy('bucket_day')
    .orderBy('bucket_day', 'asc') as Array<{
      bucket_day: string;
      revenue: string | null;
      count: string;
    }>;

  const timeSeriesPoints = dailyRows.map((row) => {
    const from = new Date(row.bucket_day).toISOString();
    const to = new Date(
      new Date(row.bucket_day).getTime() + 24 * 60 * 60 * 1000 - 1
    ).toISOString();

    const ordersCount =
      row.count != null ? Number(row.count) : null;

    return {
      from,
      to,

      revenueObserved:
        row.revenue != null ? Number(row.revenue) : null,

      ordersCount,

      coveragePct:
        ordersCount != null && ordersCount > 0 ? 100 : null,
    };
  });

console.log('[finances:epistemic] facts', {
  totalRevenue: totalRevenue,
  totalCosts: totalCosts,
  netResult: netResult,
  refundsObserved: refundsObserved,
  completenessPct: completenessPct,
});

  return {
    shopId,
    period,

    totalRevenue,
    totalCosts,
    netResult,
    refundsObserved,
    ordersCount,

    dataCoverage: {
      completenessPct,
    },

    timeSeries: {
      bucket: 'day',
      points: timeSeriesPoints,
    },

    extractedAt: new Date().toISOString(),
  };
}