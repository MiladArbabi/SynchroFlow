import { Knex } from 'knex';

import { logConflictResolved, logIdempotentSkip } from '../conflict-resolution/conflict.logger.js';
import { ConflictTypes, ResolutionStrategies } from '../conflict-resolution/conflict.types.js';

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
  /* console.debug('[RISK_PROJECTION][INVENTORY_BLOCKED_REVENUE]', {
    orderId,
    blockedRevenue: inventoryBlockedRevenue
  }); */

  /**
   * SOURCE OF TRUTH: order_constraints (migration 0070)
   * -----------------------------------------------------
   * order_constraint_events was the legacy table — now deprecated.
   * All constraint writers (customer, operational, inventory) write
   * exclusively to order_constraints. Reading from order_constraint_events
   * misses all data written by current projection layer.
   */
  const customerConstraint = await trx('order_constraints')
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
   * SOURCE OF TRUTH: order_constraints (migration 0070)
   * -----------------------------------------------------
   * Same reasoning as customer constraint above.
   */
  const operationalConstraint = await trx('order_constraints')
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

  /**
   * IDEMPOTENCY READ (WITH ROW LOCK)
   * ---------------------------------
   * forUpdate() prevents two concurrent transactions from both
   * passing the version guard and writing duplicate snapshots.
   * Without it, the guard is a non-atomic check-then-act — TOCTOU race.
   */
  const existing = await trx('order_risk_snapshot')
    .where({ lasyncro_order_id: orderId })
    .select('aggregate_version')
    .forUpdate()
    .first();

  if (existing && existing.aggregate_version >= aggregateVersion) {
    logIdempotentSkip({
      entity: 'order_risk_snapshot',
      id: orderId,
      incomingVersion: aggregateVersion,
      existingVersion: existing.aggregate_version
    });
    return;
  }

  // CONFLICT POLICY (EXPLICIT)
  // Type: DUPLICATE_EVENT (same order snapshot)
  // Strategy: MERGE (latest projection overwrites previous)
  const conflictType = ConflictTypes.DUPLICATE_EVENT;
  const resolutionStrategy = ResolutionStrategies.MERGE;

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
    /**
     * VERSIONED CONFLICT TARGET (CRITICAL)
     * -----------------------------------
     * Must match composite PK:
     * (lasyncro_order_id, aggregate_version)
     *
     * Prevents:
     * - cross-version overwrite
     * - loss of historical risk state
     */
    .onConflict(['lasyncro_order_id', 'aggregate_version'])
    .merge({
      shop_id: shopId,
      aggregate_version: aggregateVersion,
      is_inventory_blocked: isInventoryBlocked,
      is_customer_blocked: isCustomerBlocked,
      is_operational_blocked: isOperationalBlocked,
      inventory_blocked_revenue: inventoryBlockedRevenue,
      is_at_risk: isInventoryBlocked || isCustomerBlocked || isOperationalBlocked,
      order_health_score: Math.round(healthScore * 100),
      evaluated_at: eventAnchor
    })
    .then(() => {
      logConflictResolved({
        entity: 'order_risk_snapshot',
        conflictKey: 'lasyncro_order_id',
        conflictType,
        resolutionStrategy,
        note: 'Projection snapshot merged (deterministic overwrite)'
      });
    });
}