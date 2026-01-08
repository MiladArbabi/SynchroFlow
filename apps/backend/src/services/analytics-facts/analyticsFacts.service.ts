// apps/backend/src/services/analytics-facts/analyticsFacts.service.ts

import db from 'api-db';
import { AnalyticsFacts } from './analyticsFacts.types';

interface GetAnalyticsFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * getAnalyticsFacts
 *
 * Layer 1 (Facts) for Analytics.
 *
 * Guarantees:
 * - DB access only
 * - Raw aggregates only (SUM, COUNT)
 * - Preserves nulls (null ≠ 0)
 * - No intelligence, no percentages, no statuses
 * - If Analytics ever needs money again,
 *    it must consume Finances FT2 exposure, 
 *    never compute it.
 */
export async function getAnalyticsFacts(
  input: GetAnalyticsFactsInput
): Promise<AnalyticsFacts> {
  const { shopId, period } = input;

  // --- Orders by fulfillment status (raw counts) ---
  const rows = await db('order_fulfillment_status')
    .where('shop_id', shopId)
    .groupBy('status')
    .select('status', db.raw('count(*)::int as count'));

  if (rows.length === 0) {
    return {
      shopId,
      period,
      ordersObserved: {
        processing: null,
        delivered: null,
        in_transit: null,
      },
      extractedAt: new Date().toISOString(),
    };
  }

  const ordersObserved = {
    processing: null as number | null,
    delivered: null as number | null,
    in_transit: null as number | null,
  };

  for (const row of rows) {
    if (row.status === 'processing') ordersObserved.processing = row.count;
    if (row.status === 'delivered') ordersObserved.delivered = row.count;
    if (row.status === 'in_transit') ordersObserved.in_transit = row.count;
  }

  return {
    shopId,
    period,
    ordersObserved,
    extractedAt: new Date().toISOString(),
  };
}