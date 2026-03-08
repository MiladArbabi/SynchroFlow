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
    /**
     * PRIORITY STACK DATA
     * -------------------
     * Only expose fields required by the FT2 priority stack UI.
     *
     * Ranking is already encoded in order_health_score
     * by the reconciliation projection.
     */
    .select(
      'ors.lasyncro_order_id as order_id',
      'ors.order_health_score',
      'ors.evaluated_at'
    )
    .where('ors.shop_id', shopId)

    /**
     * PRIORITY ORDERING
     * -----------------
     * Ordering must match the canonical ranking defined
     * inside the reconciliation projection.
     *
     * API layer must never introduce independent ranking logic.
     *
     * Current implementation relies solely on the
     * projected order_health_score which already encodes
     * the reconciliation priority model.
     */

    .orderBy([
      { column: 'ors.order_health_score', order: 'desc' },
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