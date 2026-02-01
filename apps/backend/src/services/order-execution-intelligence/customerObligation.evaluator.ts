/**
 * Customer Obligation v3 — Evaluator
 * ---------------------------------
 * Truth source:
 * - order_revenue_units
 *
 * Rules:
 * - SKU-level only
 * - No inference
 * - NULL = not evaluated
 * - false = evaluated, not blocked
 * - true = evaluated, blocked
 *
 * This evaluator MUST NOT:
 * - Read payment_state
 * - Read order totals
 * - Infer customer intent
 */

import db from 'api-src/db';

/**
 * Evaluates customer obligation at SKU level.
 *
 * Current v3 signal:
 * - Explicit dispute / manual hold only
 */
export async function evaluateCustomerObligations(
  shopId: number,
  canonicalOrderId?: string
) {
  const q = db('order_revenue_units')
    .where({ shop_id: shopId })
    .whereNull('has_customer_block');

  if (canonicalOrderId) {
    q.andWhere({ canonical_order_id: canonicalOrderId });
  }

  await q.update({
    has_customer_block: false,
    customer_block_evaluated_at: db.fn.now(),
  });
}

