import db from 'api-src/db';
import { resolveFt2Range } from 'api-src/utils/ft2Period';

/**
 * Customer Promise Facts (Layer 1)
 * --------------------------------
 * Observes whether customer-facing delivery promises exist.
 *
 * Question:
 * - Do orders contain an explicit delivery promise in this period?
 *
 * Guarantees:
 * - Presence-only
 * - No SLA or timing semantics
 * - No fulfillment dependency
 * - Deterministic
 *
 * Fail-closed:
 * - Missing or uncertain data → promiseSignal = 'absent'
 */
export async function extractOrderCustomerPromiseFacts(
  shopId: number,
  range: Parameters<typeof resolveFt2Range>[0]
) {
  const { from, to } = resolveFt2Range(range);

  const row = await db('orders')
    .where({ shop_id: shopId })
    .andWhere('created_at', '>=', from)
    .andWhere('created_at', '<=', to)
    .whereNotNull('delivery_date') // ⬅️ adjust ONLY if factual column differs
    .count<{ total: string }>('id as total')
    .first();

  if (!row || Number(row.total) === 0) {
    return {
      promiseSignal: 'absent' as const,
      visibility: 'insufficient' as const,
    };
  }

  return {
    promiseSignal: 'present' as const,
    visibility: 'sufficient' as const,
  };
}