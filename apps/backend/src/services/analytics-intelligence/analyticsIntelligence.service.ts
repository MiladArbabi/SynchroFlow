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
  const { revenueObserved } = facts;

  if (revenueObserved === null) {
    return {
      revenueObserved: null,
      outcome: { status: 'unknown' },
      trend: { direction: 'unknown' },
    };
  }

  if (revenueObserved === 0) {
    return {
      revenueObserved,
      outcome: { status: 'negative' },
      trend: { direction: 'unknown' },
    };
  }

  return {
    revenueObserved,
    outcome: { status: 'positive' },
    trend: { direction: 'unknown' },
  };
}