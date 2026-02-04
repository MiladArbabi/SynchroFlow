import db from 'api-src/db';

type ExecutionRow = {
  order_id: string;        // platform order id
  status: 'processing' | 'in_transit' | 'delivered' | 'cancelled';
  revenue: number;
};

/**
 * aggregateBlockedRevenue (FT2-safe)
 * ---------------------------------
 * Computes CONSTRAINED blocked revenue only.
 *
 * Definition (v1):
 * - Revenue tied to orders with explicit obligation flags = TRUE
 * - Backlog or non-delivered status is NOT a constraint
 *
 * IMPORTANT:
 * - Absence of constraints MUST return 0 (not backlog)
 * - No default attribution
 * - No coverage-based inference
 *
 * This function is the ONLY source feeding FT2 Obligation Overview.
 */
export async function aggregateBlockedRevenue(
  shopId: number
): Promise<{
  constrainedBlockedTotal: number;
}> {
  /**
   * aggregateBlockedRevenue (v2)
   * ----------------------------
   * Computes constrained (explicitly blocked) revenue only.
   *
   * Definition:
   * - Inventory block OR
   * - Customer block OR
   * - Operational block
   *
   * Excludes:
   * - Unfulfilled but unconstrained orders
   * - Aging, delays, likelihoods
   */

  const row = await db('order_fulfillment_status as ofs')
    .join(
      'canonical_orders as o',
      'o.canonical_order_id',
      'ofs.canonical_order_id'
    )
    .where('ofs.shop_id', shopId)
    .andWhere(function () {
      this.where('ofs.has_inventory_block', true)
        .orWhere('ofs.has_customer_block', true)
        .orWhere('ofs.has_operational_block', true);
    })
    .sum<{ sum: string | null }>('o.total_price as sum')
    .first();

  return {
    constrainedBlockedTotal: Number(row?.sum ?? 0),
  };
};

/**
 * NOTE:
 * -----
 * Blocked revenue classification was intentionally removed.
 *
 * Reason:
 * - Legacy logic treated backlog as blocked
 * - Conflicted with constrained-obligation model
 * - No remaining consumers exist
 *
 * Any future obligation attribution MUST:
 * - Be event-backed
 * - Use explicit obligation flags
 * - Live in a separate, versioned module
 */
