import db from 'api-db';
import type { FinancesFacts } from './FinancesFacts.types';

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
 * Canonical source of raw financial truth.
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
   * Revenue — canonical truth
   * ------------------------
   * Source: canonical_orders.total_price
   * This is the ONLY authoritative monetary signal available today.
   */
  const revenueRow = await db('canonical_orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', period.from)
    .andWhere('order_created_at', '<=', period.to)
    .sum<{ sum: string | null }>('total_price as sum')
    .first();

  const totalRevenue =
    revenueRow?.sum != null ? Number(revenueRow.sum) : null;

/**
 * Refunds — canonical truth (if available)
 * ---------------------------------------
 * Source: canonical_orders.total_price (negative orders or future refund table)
 *
 * Rules:
 * - Null means no refund evidence exists
 * - Zero is a valid observed value
 * - No assumptions about materiality
 */
const refundRow = await db('canonical_orders')
  .where('shop_id', shopId)
  .andWhere('order_created_at', '>=', period.from)
  .andWhere('order_created_at', '<=', period.to)
  .andWhere('total_price', '<', 0)
  .sum<{ sum: string | null }>('total_price as sum')
  .first();

const refundsObserved =
  refundRow?.sum != null ? Math.abs(Number(refundRow.sum)) : null;

  /**
   * Costs — factually unavailable
   * -----------------------------
   * estimated_unit_cost is not populated yet.
   * product_costs is not join-safe.
   * Therefore: costs MUST remain null.
   */
  const totalCosts: number | null = null;

  const netResult =
    totalRevenue == null || totalCosts == null
      ? null
      : totalRevenue - totalCosts;

  /**
   * Data Coverage — factual only
   * ----------------------------
   * Coverage here answers ONE question:
   * "Did we observe any canonical orders in this period?"
   *
   * - 0 orders  → null (no evidence)
   * - ≥1 orders → 100 (fully observed)
   */
  const ordersCountRow = await db('canonical_orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', period.from)
    .andWhere('order_created_at', '<=', period.to)
    .count<{ count: string }>('id as count')
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
  
  const dailyRows = await db('canonical_orders')
    .select(
      db.raw(
        `
        date_trunc('day', order_created_at AT TIME ZONE 'UTC') as bucket_day,
        SUM(total_price) as revenue,
        COUNT(id) as count
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