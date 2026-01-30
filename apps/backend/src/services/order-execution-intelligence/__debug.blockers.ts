// apps/backend/src/services/order-execution-intelligence/__debug.blockers.ts

import { aggregateBlockedRevenue } from './blocker.aggregates';

/**
 * DEBUG ONLY — REMOVE AFTER AUDIT
 * --------------------------------
 * Dry-run blocked revenue aggregation.
 * No writes. No exposure. No FT2 wiring.
 */
export async function debugBlockedRevenue(shopId: number) {
  const result = await aggregateBlockedRevenue(shopId);

  console.log('[DEBUG][Blocked Revenue Aggregation]', {
    shopId,
    totalBlocked: result.totalBlocked,
    byCategory: result.byCategory,
  });

  return result;
}
