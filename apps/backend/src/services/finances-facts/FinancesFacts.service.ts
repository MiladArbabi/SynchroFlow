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

  // Aggregate revenue
  const revenueResult = await db('historical_sales')
    .where('shop_id', shopId)
    .andWhereBetween('date', [period.from, period.to])
    .sum<{ sum: string | null }>('revenue as sum')
    .first();

  const totalRevenue =
    revenueResult?.sum == null ? null : Number(revenueResult.sum);

  // Aggregate costs
  const costResult = await db('product_costs')
    .where('shop_id', shopId)
    .andWhereBetween('date', [period.from, period.to])
    .sum<{ sum: string | null }>('cost as sum')
    .first();

  const totalCosts =
    costResult?.sum == null ? null : Number(costResult.sum);

  const netResult =
    totalRevenue == null || totalCosts == null
      ? null
      : totalRevenue - totalCosts;

  // Data coverage — factual only (no interpretation)
  const completenessPct =
    totalRevenue == null && totalCosts == null ? null : 100;

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