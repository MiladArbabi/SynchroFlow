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

    const constraints = await trx('order_constraints')
        .where({ lasyncro_order_id: orderId, is_active: true })
        .select('constraint_type', 'block_type', 'started_at');

      /**
       * FIX (2026-07-01, corrected 2026-07-02): order_constraints is the
       * documented single source of truth (constraint_system_blueprint.md),
       * but nothing guarantees `decisions` stays in sync with it — a
       * decision recommending resolve_{type}_block is stale if the
       * matching constraint type has zero active rows right now.
       *
       * CORRECTED: the original version only checked the single
       * top-priority decision — if THAT one was stale, it gave up and
       * returned null entirely, even when a different, perfectly valid,
       * non-stale decision existed right behind it (confirmed live: an
       * order with both a stale resolve_inventory_block decision and a
       * real resolve_customer_block decision at the same priority —
       * whichever the DB happened to return first from the tie
       * determined whether the address-correction UI rendered at all).
       *
       * Fixed to fetch ALL pending/in_progress decisions in priority
       * order, then return the FIRST one that isn't stale — not just
       * check-then-give-up on the top one.
       */
      const CONSTRAINT_TYPE_BY_ACTION: Record<string, string> = {
        resolve_inventory_block: 'inventory',
        resolve_customer_block: 'customer',
        resolve_operational_block: 'operational',
      };

      const candidateDecisions = await trx('decisions')
        .where({ entity_id: orderId, shop_id: shopId })
        .whereIn('status', ['pending', 'in_progress'])
        .orderBy('priority', 'desc');

      if (candidateDecisions.length === 0) {
        /**
         * BL-15 — constraints are truth; decisions are enrichment.
         *
         * Returning null here made the route 404, and OrderDetailModalBody
         * derives hasAnyActiveConstraint from this response — so an order
         * with a real active order_constraints row but no decision rendered
         * "In pool" / "No open issues" while the Blocked column listed it
         * (confirmed live: 16942808629618, 16942811840882, 16953881428338,
         * all customer:incomplete_address, all repaired 2026-08-08 11:13
         * with no decision generated).
         *
         * Mirrors the all-candidates-stale branch below: a missing decision
         * must never suppress a real constraint. 404 now means only "no
         * decision AND no constraint".
         */
        if (constraints.length > 0) {
          return { decision: null, constraints };
        }
        return null;
      }

      const decision = candidateDecisions.find((d) => {
        const requiredType = CONSTRAINT_TYPE_BY_ACTION[d.recommended_action?.type];
        return !requiredType || constraints.some((c) => c.constraint_type === requiredType);
      });

      if (!decision) {
        console.warn('[ORDER_DECISION_ALL_CANDIDATES_STALE]', {
          orderId,
          candidateCount: candidateDecisions.length,
          candidateActionTypes: candidateDecisions.map((d) => d.recommended_action?.type),
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