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

  const completenessPct =
    ordersCountRow?.count != null && Number(ordersCountRow.count) > 0
      ? 100
      : null;

  console.debug('[FinancesFacts] extracted canonical snapshot', {
    shopId,
    period,
    totalRevenue,
    totalCosts,
    netResult,
    completenessPct,
  });

  return {
    shopId,
    period,

    totalRevenue,
    totalCosts,
    netResult,

    dataCoverage: {
      completenessPct,
    },

    extractedAt: new Date().toISOString(),
  };
}