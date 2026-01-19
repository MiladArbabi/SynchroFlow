// apps/backend/src/services/analytics-ft2.provider.ts
import { getAnalyticsFacts } from './analytics-facts';
import { buildAnalyticsIntelligence } from './analytics-intelligence';
import { buildAnalyticsFtep } from './analytics-ftep';
import { AnalyticsFT2Exposure } from './analytics-ftep/analyticsFtep.types';
import { OrderFactsPeriod } from './order-facts';

/**
 * getAnalyticsFt2Snapshot
 *
 * Canonical FT2 provider for Analytics.
 *
 * Pipeline:
 * Facts → Intelligence → FTEP
 *
 * This function must remain:
 * - Deterministic
 * - Branch-free
 * - Meaning-free
 */
export async function getAnalyticsFt2Snapshot(input: {
  shopId: number;
  period: OrderFactsPeriod;
}): Promise<AnalyticsFT2Exposure> {
  const facts = await getAnalyticsFacts(input);
  const intelligence = buildAnalyticsIntelligence(facts);

  // FT2 snapshot is ALWAYS the result of FTEP
  return buildAnalyticsFtep({ intelligence });
}
