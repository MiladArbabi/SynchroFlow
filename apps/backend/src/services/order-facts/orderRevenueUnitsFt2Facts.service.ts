/**
 * FT2 Revenue Units Facts (Layer 1)
 * --------------------------------
 * Source of truth: order_revenue_units
 *
 * Guarantees:
 * - SKU-level aggregation
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

  /**
   * STRUCTURAL REVENUE (NET VIEW)
   * -----------------------------
   * Immutable revenue units
   * Net of refunds
   * No execution inference
   */
  const rows = await db('order_revenue_units_net as runet')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'runet.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .select('runet.net_revenue');

  let total = 0;

  for (const r of rows) {
    const v = Number(r.net_revenue);
    if (!Number.isFinite(v)) continue;
    total += v;
  }

  return {
    total,
    earned: total,
    pending: total,
    blocked: 0,
  };
}
