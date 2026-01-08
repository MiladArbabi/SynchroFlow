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

  // historical_sales has no monetary column → revenue is unknown
  const totalRevenue: number | null = null;

  // Costs schema not guaranteed → treat as unknown for FT2
  const totalCosts: number | null = null;

  const netResult =
    totalRevenue == null || totalCosts == null
      ? null
      : totalRevenue - totalCosts;

  const completenessPct = null;

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