import { Knex } from 'knex';

/**
 * ORDER RISK PROJECTION
 * ---------------------
 * Computes operational risk indicators for an order.
 *
 * Deterministic inputs:
 * - order_fulfillment_status
 * - order_age_snapshot
 *
 * Guarantees:
 * - deterministic rebuild
 * - no wall clock influence
 */
export async function projectOrderRisk(
  trx: Knex.Transaction,
  orderId: string,
  shopId: string,
  aggregateVersion: number,
  eventAnchor: Date
) {

  const ofs = await trx('order_fulfillment_status')
    .where({ lasyncro_order_id: orderId })
    .first();

  if (!ofs) {
    throw new Error('[RISK_PROJECTION_INVARIANT] fulfillment status missing');
  }

  /**
   * INVENTORY CONSTRAINT AGGREGATION (VARIANT-SCOPED)
   * ------------------------------------------------
   * MUST aggregate across ALL active variant-level constraints.
   *
   * DO NOT use `.first()` — that collapses variant scope into order-level boolean.
   * This is the root cause of UI misrepresentation (Issue #1).
   */
  const inventoryConstraints = await trx('order_constraints')
    .where({
      lasyncro_order_id: orderId,
      constraint_type: 'inventory',
      is_active: true
    });

  const isInventoryBlocked = inventoryConstraints.length > 0;

  /**
   * BLOCKED REVENUE (VARIANT-SCOPED)
   * --------------------------------
   * Computes revenue ONLY from constrained variants.
   *
   * JOIN:
   * - order_constraints.target_id → order_revenue_units.lasyncro_variant_id
   *
   * CRITICAL:
   * - ensures financial impact reflects true constraint scope
   * - prevents order-level overcounting
   */
  const blockedRevenueRows = await trx('order_constraints as oc')
    .join('order_revenue_units as ru', function () {
      this.on('ru.lasyncro_order_id', '=', 'oc.lasyncro_order_id')
          .andOn('ru.lasyncro_variant_id', '=', 'oc.target_id');
    })
    .where({
      'oc.lasyncro_order_id': orderId,
      'oc.constraint_type': 'inventory',
      'oc.is_active': true
    })
    .sum({
      blocked_revenue: trx.raw('ru.quantity * ru.unit_price')
    });

  const inventoryBlockedRevenue = Number(blockedRevenueRows?.[0]?.blocked_revenue ?? 0);

  /**
   * OPERATIONAL SIGNAL
   * ------------------
   * Explicit debug signal for observability
   */
  console.debug('[RISK_PROJECTION][INVENTORY_BLOCKED_REVENUE]', {
    orderId,
    blockedRevenue: inventoryBlockedRevenue
  });

  /**
   * CUSTOMER BLOCK
   * ----------------
   * Derived from active customer constraints OR unpaid state.
   */
  const customerConstraint = await trx('order_constraint_events')
    .where({
      lasyncro_order_id: orderId,
      constraint_type: 'customer',
      is_active: true
    })
    .first();

  /**
   * CUSTOMER BLOCK
   * ----------------
   * Single source-of-truth:
   * Active customer constraint events only.
   *
   * All upstream logic (e.g. unpaid orders) must be encoded
   * in the constraint engine — NOT duplicated here.
   */
  const isCustomerBlocked = !!customerConstraint;
  
  /**
   * OPERATIONAL BLOCK
   * ------------------
   * Derived from active operational constraints.
   */
  const operationalConstraint = await trx('order_constraint_events')
    .where({
      lasyncro_order_id: orderId,
      constraint_type: 'operational',
      is_active: true
    })
    .first();

  const isOperationalBlocked = !!operationalConstraint;

  let healthScore = 1;

  if (isCustomerBlocked) healthScore -= 0.4;
  if (isInventoryBlocked) healthScore -= 0.2;
  if (isOperationalBlocked) healthScore -= 0.2;

  if (healthScore < 0) healthScore = 0;

  await trx('order_risk_snapshot')
    /**
     * NOTE:
     * inventory_blocked_revenue MUST be derived from variant-scoped constraints.
     *
     * DO NOT:
     * - derive from order-level booleans
     * - reuse legacy aggregation paths
     *
     * Source of truth:
     * order_constraints.target_id
     */
    .insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      aggregate_version: aggregateVersion,

      is_inventory_blocked: isInventoryBlocked,
      inventory_blocked_revenue: inventoryBlockedRevenue,

      is_customer_blocked: isCustomerBlocked,
      is_operational_blocked: isOperationalBlocked,

      is_at_risk: isInventoryBlocked || isCustomerBlocked || isOperationalBlocked,

      order_health_score: Math.round(healthScore * 100),

      evaluated_at: eventAnchor
    })
    .onConflict('lasyncro_order_id')
    .merge();
}