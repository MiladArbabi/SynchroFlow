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
 */
export async function getAnalyticsFacts(
  input: GetAnalyticsFactsInput
): Promise<AnalyticsFacts> {
  const { shopId, period } = input;

  // --- Revenue (raw SUM) ---
  const revenueResult = await db('historical_sales as hs')
    .where('hs.shop_id', shopId)
    .andWhere('hs.sale_date', '>=', period.from)
    .andWhere('hs.sale_date', '<=', period.to)
    .sum({ total: db.raw('hs.quantity_sold * hs.price') });

  const revenueObserved =
    revenueResult?.[0]?.total != null
      ? Number(revenueResult[0].total)
      : null;

  // --- COGS (raw SUM) ---
  const cogsResult = await db('historical_sales as hs')
    .where('hs.shop_id', shopId)
    .andWhere('hs.sale_date', '>=', period.from)
    .andWhere('hs.sale_date', '<=', period.to)
    .sum({ total: db.raw('hs.quantity_sold * hs.cost') });

  const cogsObserved =
    cogsResult?.[0]?.total != null
      ? Number(cogsResult[0].total)
      : null;

  // --- Orders by fulfillment status (raw counts) ---
  const rows = await db('order_fulfillment_status')
    .where('shop_id', shopId)
    .groupBy('status')
    .select('status', db.raw('count(*)::int as count'));

  if (rows.length === 0) {
    return {
      shopId,
      period,
      revenueObserved,
      cogsObserved,
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
    revenueObserved,
    cogsObserved,
    ordersObserved,
    extractedAt: new Date().toISOString(),
  };
}