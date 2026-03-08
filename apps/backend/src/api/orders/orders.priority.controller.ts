import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/orders/decision/priority-stack
 *
 * Contract:
 * - Authoritative ranking from order_risk_snapshot
 * - Deterministic ordering (already computed in reconciliation)
 * - No re-sorting
 * - No inference
 * - Replace-on-reconcile respected
 */
export const httpGetPriorityStack = async (
  req: Request,
  res: Response
) => {
  try {
    /**
     * TENANT IDENTITY RESOLUTION
     * --------------------------
     * Priority stack must always be scoped to the authenticated tenant.
     *
     * Using req.user.shopId ensures:
     * - strict tenant isolation
     * - consistent API contract across controllers
     * - no cross-shop data exposure
     */
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({
        error: 'Unauthorized: missing shop context',
      });
    }

    console.debug('[Decision][PriorityStack] Fetch ranked orders', {
      shopId,
    });

    const rows = await db('order_risk_snapshot as ors')
      .join('order_age_snapshot as oas', 'oas.lasyncro_order_id', 'ors.lasyncro_order_id')
      .join('order_margin_snapshot as oms', 'oms.lasyncro_order_id', 'ors.lasyncro_order_id')
    /**
       * PRIORITY RANKING DATA REQUIREMENTS
       * ----------------------------------
       * The API must expose fields required for canonical
       * priority ordering defined in reconciliation.
       *
       * These fields are derived from authoritative snapshots.
       */
      .select(
        'ors.lasyncro_order_id as order_id',
        'ors.order_health_score',
        'ors.is_inventory_blocked',
        'ors.is_customer_blocked',
        'ors.is_operational_blocked',
        'ors.is_at_risk',
        'ors.fraud_score',
        'ors.return_probability',
        'ors.evaluated_at',
        'oas.is_shipping_sla_breached',
        'oas.age_since_paid_seconds',
        'oms.gross_margin'
      )
    .where('ors.shop_id', shopId)
    /**
     * CANONICAL PRIORITY ORDERING
     * ---------------------------
     * Must match reconciliation ordering exactly.
     *
     * This prevents priority drift between:
     * - operational snapshots
     * - UI decision stack
     */
    .orderBy([
      { column: 'ors.order_health_score', order: 'desc' },
      { column: 'oas.is_shipping_sla_breached', order: 'desc' },
      { column: 'oms.gross_margin', order: 'asc' },
      { column: 'oas.age_since_paid_seconds', order: 'desc' },
      { column: 'ors.lasyncro_order_id', order: 'asc' },
]);

    console.debug('[Decision][PriorityStack] Rows', {
      count: rows.length,
    });

    res.status(200).json(rows);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      error: `Failed to fetch priority stack: ${message}`,
    });
  }
};