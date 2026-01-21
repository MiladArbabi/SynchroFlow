import db from 'api-src/db';
import { resolveFt2Range } from 'api-src/utils/ft2Period';

/**
 * Fulfillment Facts (Layer 1)
 * ---------------------------
 * Observes whether operational fulfillment signals exist.
 *
 * Guarantees:
 * - Presence-only
 * - Time-scoped
 * - No interpretation
 */
export async function extractOrderFulfillmentFacts(
  shopId: number,
  range: Parameters<typeof resolveFt2Range>[0]
) {
  /**
   * order_fulfillment_status is STATE-based.
   * Exactly one row per order.
   * DO NOT apply FT2 time ranges here.
   */
  const row = await db('order_fulfillment_status')
    .where({ shop_id: shopId })
    .count<{ total: string }>('id as total')
    .first();

  if (!row || Number(row.total) === 0) {
    return {
      fulfillmentSignal: 'absent' as const,
      visibility: 'insufficient' as const,
    };
  }

  return {
    fulfillmentSignal: 'present' as const,
    visibility: 'sufficient' as const,
  };
}