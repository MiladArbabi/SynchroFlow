import { Request, Response } from 'express';
import { computeReturnsIntelligence, getOrphanedReturnJobs } from '../../services/returns/returnsIntelligence.service.js';
/**
 * GET /api/v1/modules/returns
 * ----------------------------
 * Returns shop-level returns intelligence summary and per-variant breakdown.
 *
 * Sources:
 * - refund_executions (refund records)
 * - order_revenue_units (line item revenue and cost)
 * - inventory_movements (refund_return movements for restock rate)
 * - return_jobs (orphaned-job aging, RT2-03)
 *
 * RULES:
 * - Authenticated + shop-scoped
 * - Read-only — never mutates
 * - RLS enforced via computeReturnsIntelligence + getOrphanedReturnJobs
 *
 * Intelligence summary and orphan aging are fetched as sibling queries
 * (not one shared transaction) — orphan data doesn't need transactional
 * consistency with the summary stats, and getOrphanedReturnJobs already
 * opens its own withTenant scope.
 */
export const httpGetReturns = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const [result, orphanedJobs] = await Promise.all([
      computeReturnsIntelligence(shopId),
      getOrphanedReturnJobs(shopId),
    ]);
    return res.status(200).json({ ...result, orphaned_jobs: orphanedJobs });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[RETURNS_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch returns intelligence: ${message}`,
    });
  }
};