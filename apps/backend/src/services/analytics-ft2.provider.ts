// apps/backend/src/services/analytics-ft2.provider.ts

import { getAnalyticsFacts } from './analytics-facts';
import { buildAnalyticsIntelligence } from './analytics-intelligence';
import { buildAnalyticsFtep } from './analytics-ftep';
import { AnalyticsFT2Exposure } from './analytics-ftep/analyticsFtep.types';

/**
 * Analytics FT2 Provider
 * ---------------------
 * Orchestrates the FT2 pipeline:
 *
 *   Facts → Intelligence → FTEP
 *
 * Rules:
 * - No lifecycle decisions
 * - No persistence beyond Facts
 * - No intelligence leakage
 * - Deterministic for identical inputs
 */
export async function getAnalyticsFt2Snapshot(input: {
  shopId: number;
  period: { from: string; to: string };
}): Promise<AnalyticsFT2Exposure> {
  const facts = await getAnalyticsFacts(input);
  const intelligence = buildAnalyticsIntelligence(facts);
  const exposure = buildAnalyticsFtep({ facts, intelligence });

  return exposure;
}