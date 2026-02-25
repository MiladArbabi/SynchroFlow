//apps/backend/src/services/order-facts/orderRevenueAllocationFacts.service.ts
import db from '@lasyncro/backend-core/db.js';

/**
 * Order Revenue Allocation Facts (Layer 1)
 * ----------------------------------------
 * Allocates order-level revenue by fulfillment state.
 *
 * Purpose:
 * - Expose where positive revenue is structurally sitting.
 *
 * Guarantees:
 * - Sovereign facts only
 * - Order-level allocation
 * - No interpretation
 * - No proportional math
 * - No settlement or payment inference
 *
 * IMPORTANT:
 * - Revenue is sourced from order_revenue_units_net.net_revenue
 * - Identity: orders.lasyncro_order_id
 * - Fulfillment is order-level and state-based
 * - Partial fulfillment is NOT supported
 */

/**
 * ⚠️ EXECUTION-AWARE REVENUE (INTERNAL)
 * ---------------------------------------------
 * This service MUST NOT be used by FT1 or FT2.
 *
 * Semantics:
 * - Uses webhook-driven fulfillment truth
 * - Preserves unknown when execution is missing
 * - Does NOT infer delivery, payment, or settlement
 *
 * Valid consumers:
 * - Phase 6 execution-aware revenue resolvers ONLY
 */

export async function extractOrderRevenueAllocationFacts(
  shopId: number,
): Promise<{
  fulfilledRevenueTotal: number;
  unfulfilledRevenueTotal: number;
  unknownRevenueTotal: number;
}> {

  /**
   * STRUCTURAL REVENUE SOURCE (NET VIEW)
   * ------------------------------------
   * Revenue derived from immutable revenue units.
   * Net of refunds via order_revenue_units_net.
   */
  const rows = await db('order_revenue_units_net as runet')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'runet.lasyncro_order_id'
    )
    .leftJoin(
      'order_fulfillment_status as f',
      'o.lasyncro_order_id',
      'f.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .groupBy(
      'o.lasyncro_order_id',
      'f.status'
    )
    .select(
      db.raw('SUM(runet.net_revenue) as revenue'),
      'f.status as fulfillmentStatus'
    );

  if (!rows || rows.length === 0) {
    /**
     * No orders in scope.
     *
     * This is NOT an epistemic unknown.
     * It is a real, observed zero.
     *
     * Visibility insufficiency (if any) is handled
     * by the execution-aware resolver.
     */
    return {
      fulfilledRevenueTotal: 0,
      unfulfilledRevenueTotal: 0,
      unknownRevenueTotal: 0,
    };
  }

  let fulfilled = 0;
  let unfulfilled = 0;
  let unknown = 0;

  for (const row of rows) {
    if (row.revenue == null) continue;

    if (row.fulfillmentStatus === null) {
      // Missing execution truth → epistemic unknown
      unknown += Number(row.revenue);
      continue;
    }

    if (
      row.fulfillmentStatus === 'fulfilled'
    ) {
      fulfilled += Number(row.revenue);
    } else {
      unfulfilled += Number(row.revenue);
    }
  }

  return {
    fulfilledRevenueTotal: fulfilled,
    unfulfilledRevenueTotal: unfulfilled,
    unknownRevenueTotal: unknown,
  };
}