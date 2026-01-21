// apps/backend/src/services/order-facts/orderShippingDelayFacts.service.ts
import db from 'api-src/db';
import { resolveFt2Range } from 'api-src/utils/ft2Period';

/**
 * Shipping Delay Facts (Layer 1)
 * -----------------------------
 * Observes whether explicit shipping delay signals exist.
 *
 * Question answered:
 * - Is there factual evidence of delayed shipping events?
 *
 * Guarantees:
 * - Presence-only
 * - No timing inference
 * - No SLA semantics
 * - Deterministic
 *
 * Fail-closed:
 * - Absence or ambiguity → delaySignal = 'absent'
 */
export async function extractOrderShippingDelayFacts(
  shopId: number,
  range: Parameters<typeof resolveFt2Range>[0]
) {
  const { from, to } = resolveFt2Range(range);

  const row = await db('shopify_fulfillments')
    .where({ shop_id: shopId })
    .andWhere('created_at', '>=', from)
    .andWhere('created_at', '<=', to)
    .andWhere('issue_flag', true) // factual delay indicator
    .count<{ total: string }>('id as total')
    .first();

  if (!row || Number(row.total) === 0) {
    return {
      delaySignal: 'absent' as const,
      visibility: 'insufficient' as const,
    };
  }

  return {
    delaySignal: 'present' as const,
    visibility: 'sufficient' as const,
  };
}