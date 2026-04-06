// apps/backend/src/api/orders/orders.decision-by-order.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/orders/:orderId/decision
 * -------------------------------------
 * Returns current decision state for a single order.
 *
 * Source of truth:
 * - decisions table (recommended_action, status, priority)
 * - order_constraints (active constraints for this order)
 *
 * RULES:
 * - Read-only
 * - RLS enforced via app.current_tenant SET LOCAL
 * - Returns latest decision by priority desc
 * - 404 if no decision exists for this order
 */
export const httpGetOrderDecision = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const result = await db.transaction(async (trx) => {
      /**
       * RLS CONTEXT (CRITICAL)
       * ----------------------
       * Must be SET LOCAL inside transaction before any RLS-protected table access.
       * Canonical variable: app.current_tenant (integer)
       */
      await trx.raw(`SET LOCAL "app.current_tenant" = ?`, [shopId]);

      const decision = await trx('decisions')
        .where({ entity_id: orderId, shop_id: shopId })
        .orderBy('priority', 'desc')
        .first();

      if (!decision) {
        return null;
      }

      const constraints = await trx('order_constraints')
        .where({ lasyncro_order_id: orderId, is_active: true })
        .select('constraint_type', 'block_type', 'started_at');

      return { decision, constraints };
    });

    if (!result) {
      return res.status(404).json({ error: 'No decision found for this order' });
    }

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ORDER_DECISION_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch order decision: ${message}`,
    });
  }
};