// apps/backend/src/services/order-facts/orderShippingFacts.service.ts

import db from 'api-src/db';
import { resolveFt2Range } from 'api-src/utils/ft2Period';

/**
 * Shipping Facts (Layer 1)
 * -----------------------
 * Observes whether shipping / fulfillment execution events exist.
 *
 * Question answered:
 * - Do shipping events exist for orders in this period?
 *
 * Guarantees:
 * - Presence-only (no status semantics)
 * - Time-scoped
 * - Deterministic
 * - No lifecycle interpretation (no delivered / delayed / SLA)
 *
 * Fail-closed:
 * - Absence or uncertainty → shippingSignal = 'absent'
 */
export async function extractOrderShippingFacts(
  shopId: number,
  range: Parameters<typeof resolveFt2Range>[0]
) {
  const { from, to } = resolveFt2Range(range);

  const row = await db('shopify_fulfillments')
    .where({ shop_id: shopId })
    .andWhere('created_at', '>=', from)
    .andWhere('created_at', '<=', to)
    .count<{ total: string }>('id as total')
    .first();

  if (!row || Number(row.total) === 0) {
    return {
      shippingSignal: 'absent' as const,
      visibility: 'insufficient' as const,
    };
  }

  return {
    shippingSignal: 'present' as const,
    visibility: 'sufficient' as const,
  };
}