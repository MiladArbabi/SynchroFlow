import { Request, Response } from 'express';
import { DecisionRepository } from '../../domain/decision/decision.repository.js';

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

    /**
     * DECISION-DRIVEN PRIORITY (NEW SYSTEM)
     * -------------------------------------
     * Replaces projection-based priority.
     *
     * Source of truth: decisions table
     */
    const rows = await DecisionRepository.getByShop(String(shopId));

    /**
     * NOTE:
     * - shop_id is stored as string (DB + RLS invariant)
     * - Explicit cast prevents type mismatch and query inconsistency
     */

    console.debug('[Decision][PriorityStack] Rows', {
      count: rows.length,
    });

    /**
     * SAFETY CHECK
     * ------------
     * If no decisions exist, system is not yet producing decisions.
     * This prevents silent fallback to broken behavior.
     */
    if (!rows || rows.length === 0) {
      return res.status(503).json({
        error: 'Decision engine not initialized: no decisions available',
      });
    }

    res.status(200).json(rows);
    
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      error: `Failed to fetch priority stack: ${message}`,
    });
  }
};