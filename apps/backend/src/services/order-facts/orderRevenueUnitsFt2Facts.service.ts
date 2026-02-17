/**
 * FT2 Revenue Units Facts (Layer 1)
 * --------------------------------
 * Source of truth: order_revenue_units
 *
 * Guarantees:
 * - SKU-level aggregation
 * - Quantity × unit_revenue only
 * - No execution inference
 * - No obligation logic
 * - FT2-safe, aggregate-only
 *
 * NEVER:
 * - Read orders.total_price
 * - Join order-level revenue
 * - Join platform IDs
 * - Classify execution
 */

/**
 * ⚠️ IMPORTANT
 * ------------
 * This function MUST NOT be used by FT2 Revenue Overview.
 *
 * Reason:
 * - FT2 Revenue Overview is ORDER-level and EXECUTION-aware
 * - This function is SKU-level and EXECUTION-AGNOSTIC
 *
 * Valid consumers:
 * - SKU OS
 * - Obligation evaluators
 * - L2 diagnostics
 */

import db from '@lasyncro/backend-core/db.js';

export async function extractRevenueUnitsFt2Facts(
  shopId: number
): Promise<{
  total: number;
  earned: number;
  pending: number;
  blocked: number;
}> {
  const rows = await db('order_revenue_units')
    .where('shop_id', shopId)
    .select(
      'quantity',
      'unit_revenue',
      'has_customer_block'
    );

  let total = 0;
  let blocked = 0;

  for (const r of rows) {
    const v = Number(r.quantity) * Number(r.unit_revenue);
    if (!Number.isFinite(v)) continue;

    total += v;
    if (r.has_customer_block === true) {
      blocked += v;
    }
  }

  return {
    total,
    earned: total - blocked,
    pending: total - blocked,
    blocked,
  };
}
