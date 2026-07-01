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

    // apps/backend/src/api/orders/orders.decision-by-order.controller.ts

    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const decision = await trx('decisions')
        .where({ entity_id: orderId, shop_id: shopId })
        .whereIn('status', ['pending', 'in_progress'])
        .orderBy('priority', 'desc')
        .first();

      if (!decision) {
        return null;
      }

      const constraints = await trx('order_constraints')
        .where({ lasyncro_order_id: orderId, is_active: true })
        .select('constraint_type', 'block_type', 'started_at');

      // FIX (2026-07-01): order_constraints is the documented single
      // source of truth (constraint_system_blueprint.md), but nothing
      // guarantees `decisions` stays in sync with it once a constraint
      // resolves through a path other than the execute button (e.g.
      // DF-04, or any pre-existing stale row from before today's
      // reconciliation.handlers.ts fix). A decision recommending
      // resolve_{type}_block is stale — not just "technically pending"
      // — if the matching constraint type has zero active rows right
      // now. Cross-checking at read time catches every variant of this
      // drift, past or future, without needing to hunt down and patch
      // every write path that could cause it.
      const CONSTRAINT_TYPE_BY_ACTION: Record<string, string> = {
        resolve_inventory_block: 'inventory',
        resolve_customer_block: 'customer',
        resolve_operational_block: 'operational',
      };
      const requiredType = CONSTRAINT_TYPE_BY_ACTION[decision.recommended_action?.type];
      const isStale = requiredType && !constraints.some((c) => c.constraint_type === requiredType);

      if (isStale) {
        console.warn('[ORDER_DECISION_STALE_SKIPPED]', {
          orderId,
          decisionId: decision.id,
          actionType: decision.recommended_action?.type,
        });
        return { decision: null, constraints };
      }

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