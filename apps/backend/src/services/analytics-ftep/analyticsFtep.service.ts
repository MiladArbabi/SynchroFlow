// apps/backend/src/services/analytics-ftep/analyticsFtep.service.ts

import { AnalyticsFacts } from '../analytics-facts/analyticsFacts.types';
import { AnalyticsIntelligence } from '../analytics-intelligence/analyticsIntelligence.types';
import { AnalyticsFT2Exposure } from './analyticsFtep.types';

interface BuildAnalyticsFtepInput {
  facts: AnalyticsFacts;
  intelligence: AnalyticsIntelligence;
}

/**
 * buildAnalyticsFtep
 *
 * Layer 3 (FTEP) for Analytics.
 *
 * Downgrades internal intelligence into FT2-safe observability.
 *
 * Rules (locked by tests):
 * - Always expose context.period
 * - Expose revenueObserved only via context
 * - If intelligence outcome is 'unknown' → outcome & trend = null
 * - Never expose percentages, margins, profit, loss, reasons
 */
export function buildAnalyticsFtep(
  input: BuildAnalyticsFtepInput
): AnalyticsFT2Exposure {
  const { facts, intelligence } = input;

  const context = {
    period: facts.period,
  };

  if (intelligence.outcome.status === 'unknown') {
    return {
      context,
      outcome: null,
      trend: null,
    };
  }

  return {
    context,
    outcome: {
      status: intelligence.outcome.status,
    },
    trend: {
      direction: intelligence.trend.direction,
    },
  };
}