// apps/backend/src/api/orders/orders.execute.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { dispatchCommand } from '../../domain/command/command.bus.js';
import { isDecisionActionStillValid } from '../../domain/decision/decisionConstraintRequirements.js';

class DecisionNotFoundError extends Error {}
class DecisionAlreadyExecutedError extends Error {}
class DecisionInProgressError extends Error {}

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
 * 4. Dispatch EXECUTE_DECISION command — commands.consumer.ts picks it
 *    up and actually invokes the handler (Thread A-2 cont'd, 2026-06-30
 *    — closes the gap where manual decisions queued but nothing ever
 *    drained them; see manualExecution.service.ts's disabled function).
 *
 * Returns:
 * - 202 Accepted — job queued and dispatched for execution
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

    let txResult: { decisionId: string; actionType?: string } | undefined;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      /**
       * STALE-DECISION DEFENCE (ORD-DECISION-01)
       * ----------------------------------------
       * Constraints are truth; decisions are enrichment. A decision
       * recommending resolve_{type}_block is stale once its required
       * constraint type has no active rows — the block it exists to
       * resolve is already gone.
       *
       * Previously this route took the top-priority pending decision and
       * queued it unconditionally, so restocking an order (which clears
       * the inventory constraint naturally, INV-RED-05) left a stale
       * resolve_inventory_block decision that /execute would still
       * accept with 202 — the read model already refused to surface it.
       *
       * Now both paths ask the same question through the same map
       * (decisionConstraintRequirements.ts). Candidates are walked in
       * priority order and the first non-stale one wins, mirroring the
       * read path's all-candidates-stale behaviour rather than giving up
       * on the top candidate alone. Actions with no constraint
       * prerequisite are unaffected.
       */
      const activeConstraintTypes: string[] = (
        await trx('order_constraints')
          .where({ lasyncro_order_id: orderId, is_active: true })
          .distinct('constraint_type')
      ).map((row: { constraint_type: string }) => row.constraint_type);

      const candidateDecisions = await trx('decisions')
        .where({ entity_id: orderId, shop_id: shopId })
        .whereIn('status', ['pending', 'in_progress'])
        .orderBy('priority', 'desc');

      const decision = candidateDecisions.find((d) =>
        isDecisionActionStillValid(
          d.recommended_action?.type,
          activeConstraintTypes
        )
      );

      if (!decision) {
        if (candidateDecisions.length > 0) {
          console.warn('[EXECUTE_ORDER_DECISION_ALL_CANDIDATES_STALE]', {
            order_id: orderId,
            shop_id: shopId,
            candidate_count: candidateDecisions.length,
            candidate_action_types: candidateDecisions.map(
              (d) => d.recommended_action?.type
            ),
            active_constraint_types: activeConstraintTypes,
          });
        }
        throw new DecisionNotFoundError('No actionable decision found for this order');
      }

      const existing = await trx('decision_execution_queue')
        .where({ decision_id: decision.id })
        .first();

      if (existing) {
        if (existing.status === 'success') {
          throw new DecisionAlreadyExecutedError('Decision already executed successfully');
        }
        if (existing.status === 'in_progress' || existing.status === 'dispatched') {
          throw new DecisionInProgressError('Decision execution already in progress');
        }
      }

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

      // Assign via closure — do NOT rely on db.transaction()'s resolved
      // return value, it does not reliably propagate through Knex's
      // transaction typing (hit this exact trap repeatedly tonight).
      txResult = { decisionId: decision.id, actionType: decision.recommended_action?.type };
    });

    // THREAD A-2 cont'd (2026-06-30): see file header. Dispatched outside
    // the transaction above — dispatchCommand has its own internal
    // transaction. commands.consumer.ts now handles EXECUTE_DECISION
    // alongside RECONCILIATION_RUN.
    if (txResult) {
      await dispatchCommand({
        type: 'EXECUTE_DECISION',
        payload: {
          shopId,
          decisionId: txResult.decisionId,
        },
        idempotencyKey: `execute-decision-${txResult.decisionId}`,
      });
    }

    return res.status(202).json({
      message: 'Execution queued',
      decision_id: txResult?.decisionId,
      action_type: txResult?.actionType,
    });
  } catch (error) {
    if (error instanceof DecisionNotFoundError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof DecisionAlreadyExecutedError || error instanceof DecisionInProgressError) {
      return res.status(409).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[EXECUTE_ORDER_DECISION_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to queue execution: ${message}`,
    });
  }
};