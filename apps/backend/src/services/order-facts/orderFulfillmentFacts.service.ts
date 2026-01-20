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
  const { from, to } = resolveFt2Range(range);

  const row = await db('order_fulfillment_status')
    .where({ shop_id: shopId })
    .andWhere('created_at', '>=', from)
    .andWhere('created_at', '<=', to)
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