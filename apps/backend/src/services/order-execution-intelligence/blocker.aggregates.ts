import db from '@lasyncro/backend-core/db.js';

/**
 * SOVEREIGN IDENTITY ANCHOR (v3)
 * ------------------------------
 * This module is UUID-anchored.
 *
 * All joins MUST use:
 *   - lasyncro_order_id
 *
 * shop_id MUST be derived from:
 *   - orders table (NOT execution tables)
 *
 * Revenue primitive:
 *   - quantity * unit_price
 */

type ExecutionRow = {
  order_id: string;        // platform order id
  status: 'processing' | 'in_transit' | 'fulfilled' | 'cancelled';
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

  /**
   * MIGRATION NOTE:
   * ---------------
   * Replaces:
   * - ofs.has_inventory_block
   * - ofs.has_customer_block
   * - ofs.has_operational_block
   *
   * With:
   * - order_constraints (canonical, scoped)
   */
  const row = await db('order_fulfillment_status as ofs')
    .join(
      'order_revenue_units as ru',
      'ru.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    /**
     * CONSTRAINT CHECK (SOURCE OF TRUTH)
     * ---------------------------------
     * MUST use order_constraints (variant-scoped)
     * DO NOT use fulfillment flags (legacy + incorrect)
     */
    .andWhere(function () {
      this.whereExists(function () {
        this.select(1)
          .from('order_constraints as oc')
          .whereRaw('oc.lasyncro_order_id = ofs.lasyncro_order_id')
          .andWhere('oc.constraint_type', 'inventory')
          .andWhere('oc.is_active', true);
      })
      .orWhereExists(function () {
        this.select(1)
          .from('order_constraints as oc')
          .whereRaw('oc.lasyncro_order_id = ofs.lasyncro_order_id')
          .andWhere('oc.constraint_type', 'customer')
          .andWhere('oc.is_active', true);
      })
      .orWhereExists(function () {
        this.select(1)
          .from('order_constraints as oc')
          .whereRaw('oc.lasyncro_order_id = ofs.lasyncro_order_id')
          .andWhere('oc.constraint_type', 'operational')
          .andWhere('oc.is_active', true);
      });
    })
    .sum<{ sum: string | null }>(
      db.raw('ru.quantity * ru.unit_price')
    )
    .first();

  return {
    constrainedBlockedTotal: Number(row?.sum ?? 0),
  };
};

/**
 * aggregateUnconstrainedPendingRevenue (FT2-safe)
 * -----------------------------------------------
 * Computes revenue that is:
 * - NOT fulfilled
 * - AND has NO obligation flags set
 *
 * This is true pending revenue.
 * No inference. No subtraction.
 */
export async function aggregatePendingRevenue(
  shopId: number
): Promise<{ pendingTotal: number }> {
    /**
   * Economic Source Constraint
   * --------------------------
   * Pending revenue MUST be computed from order_revenue_units.
   *
   * It MUST NOT use orders.total_price directly.
   *
   * Reason:
   * - total_price ignores partial refunds
   * - Ignores SKU-level return adjustments
   * - Ignores per-unit blocking semantics
   *
   * Revenue units are the only stable economic primitive.
   */

  /**
   * MIGRATION NOTE:
   * ---------------
   * Replaces all `has_*_block` flags with constraint existence check.
   *
   * Guarantees:
   * - No legacy leakage
   * - Fully aligned with constraint engine
   */

  const row = await db('order_fulfillment_status as ofs')
    .join(
      'order_revenue_units as ru',
      'ru.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .andWhere('ofs.status', '!=', 'fulfilled')
    /**
     * UNCONSTRAINED FILTER (SOURCE OF TRUTH)
     * -------------------------------------
     * Order MUST have NO active constraints of ANY type.
     */
    .whereNotExists(function () {
      this.select(1)
        .from('order_constraints as oc')
        .whereRaw('oc.lasyncro_order_id = ofs.lasyncro_order_id')
        .andWhere('oc.is_active', true);
    })
    .sum<{ sum: string | null }>(
      db.raw('ru.quantity * ru.unit_price')
    )
    .first();

  return {
    pendingTotal: Number(row?.sum ?? 0),
  };
}

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
