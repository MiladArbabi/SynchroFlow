import db from 'api-src/db';
import { resolveFt2Range } from 'api-src/utils/ft2Period';

/**
 * Fulfillment Status Facts (Layer 1)
 * ---------------------------------
 * Observes factual fulfillment state of orders.
 *
 * Rules:
 * - Presence-only
 * - Time-scoped
 * - No inference
 * - No lifecycle meaning
 */
export async function extractOrderFulfillmentStatusFacts(
  shopId: number,
  range: Parameters<typeof resolveFt2Range>[0]
) {
  const { from, to } = resolveFt2Range(range);

  const rows = await db('order_fulfillment_status')
    .where({ shop_id: shopId })
    .andWhere('created_at', '>=', from)
    .andWhere('created_at', '<=', to)
    .select('status');

  if (rows.length === 0) {
    return {
      fulfillmentStatus: 'absent' as const,
      visibility: 'insufficient' as const,
    };
  }

  const fulfilledCount = rows.filter((r) =>
    ['fulfilled', 'delivered'].includes(r.status)
  ).length;

  if (fulfilledCount === rows.length) {
    return {
      fulfillmentStatus: 'fulfilled' as const,
      visibility: 'sufficient' as const,
    };
  }

  if (fulfilledCount === 0) {
    return {
      fulfillmentStatus: 'unfulfilled' as const,
      visibility: 'sufficient' as const,
    };
  }

  return {
    fulfillmentStatus: 'partial' as const,
    visibility: 'sufficient' as const,
  };
}