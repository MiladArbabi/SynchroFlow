// apps/backend/src/services/analytics-intelligence/analyticsIntelligence.service.ts

import { AnalyticsFacts } from '../analytics-facts/analyticsFacts.types';
import { AnalyticsIntelligence } from './analyticsIntelligence.types';

/**
 * buildAnalyticsIntelligence
 *
 * Layer 2 (Intelligence) for Analytics.
 *
 * Converts raw facts → classified meaning.
 *
 * Rules (locked by tests):
 * - positive: revenueObserved > 0
 * - negative: revenueObserved === 0
 * - unknown: revenueObserved === null
 * - trend: always 'unknown'
 *
 * Forbidden:
 * - DB access
 * - Percentages
 * - Margins
 * - Explanations
 * - Recommendations
 */
export function buildAnalyticsIntelligence(
  facts: AnalyticsFacts
): AnalyticsIntelligence {
  const { processing, delivered, in_transit } = facts.ordersObserved;

  const values = [processing, delivered, in_transit];

  const allNull = values.every(v => v === null);
  if (allNull) {
    return {
      outcome: { status: 'unknown' },
      trend: { direction: 'unknown' },
    };
  }

  const allZero = values.every(v => v === 0);
  if (allZero) {
    return {
      outcome: { status: 'negative' },
      trend: { direction: 'unknown' },
    };
  }

  return {
    outcome: { status: 'positive' },
    trend: { direction: 'unknown' },
  };
}