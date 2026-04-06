// apps/backend/src/api/orders/orders.execute.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * POST /api/v1/orders/:orderId/execute
 * -------------------------------------
 * Triggers execution of the recommended decision action for an order.
 *
 * SECURITY INVARIANTS:
 * - Operator never specifies the action — it is read from the decisions table
 * - shop_id scoping prevents cross-tenant execution
 * - RLS enforced via app.current_tenant SET LOCAL
 *
 * Execution flow:
 * 1. Load decision for this order (tenant-scoped)
 * 2. Validate decision exists and is in executable state
 * 3. Insert into decision_execution_queue (idempotent)
 * 4. Dispatcher picks up and routes to execution.worker
 *
 * Returns:
 * - 202 Accepted — job queued, not yet executed
 * - 400 — no actionable decision found
 * - 409 — already executing or executed
 */
export const httpExecuteOrderDecision = async (
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

    await db.transaction(async (trx) => {
      /**
       * RLS CONTEXT (CRITICAL)
       * ----------------------
       * Must be SET LOCAL inside transaction before any RLS-protected table access.
       * Canonical variable: app.current_tenant (integer)
       */
      await trx.raw(`SET LOCAL "app.current_tenant" = ?`, [shopId]);

      /**
       * LOAD DECISION (CRITICAL)
       * ------------------------
       * Operator never dictates the action.
       * Action is always sourced from the decision engine output.
       */
      const decision = await trx('decisions')
        .where({ entity_id: orderId, shop_id: shopId })
        .whereIn('status', ['pending', 'in_progress'])
        .orderBy('priority', 'desc')
        .first();

      if (!decision) {
        return res.status(400).json({
          error: 'No actionable decision found for this order',
        });
      }

      /**
       * IDEMPOTENCY CHECK
       * -----------------
       * Prevent duplicate queue entries for the same decision.
       * decision_id is UNIQUE in decision_execution_queue.
       */
      const existing = await trx('decision_execution_queue')
        .where({ decision_id: decision.id })
        .first();

      if (existing) {
        if (existing.status === 'success') {
          return res.status(409).json({ error: 'Decision already executed successfully' });
        }
        if (existing.status === 'in_progress' || existing.status === 'dispatched') {
          return res.status(409).json({ error: 'Decision execution already in progress' });
        }
      }

      /**
       * ENQUEUE FOR EXECUTION
       * ---------------------
       * Dispatcher polls this table and routes to execution.worker.
       * executed_at is set ONLY by execution.worker on completion.
       */
      await trx('decision_execution_queue')
        .insert({
          decision_id: decision.id,
          shop_id: shopId,
          status: 'pending',
          created_at: trx.fn.now(),
        })
        .onConflict('decision_id')
        .ignore();

      console.info('[EXECUTE_ORDER_DECISION_QUEUED]', {
        order_id: orderId,
        decision_id: decision.id,
        action_type: decision.recommended_action?.type,
        shop_id: shopId,
      });

      return res.status(202).json({
        message: 'Execution queued',
        decision_id: decision.id,
        action_type: decision.recommended_action?.type,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[EXECUTE_ORDER_DECISION_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to queue execution: ${message}`,
    });
  }
};