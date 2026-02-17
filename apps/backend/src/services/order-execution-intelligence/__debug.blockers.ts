// apps/backend/src/services/order-execution-intelligence/__debug.blockers.ts

import { aggregateBlockedRevenue } from './blocker.aggregates.js';

/**
 * DEBUG ONLY — REMOVE AFTER AUDIT
 * --------------------------------
 * Dry-run blocked revenue aggregation.
 * No writes. No exposure. No FT2 wiring.
 */

export async function debugBlockedRevenue(shopId: number) {
  const { constrainedBlockedTotal } =
    await aggregateBlockedRevenue(shopId);

  console.log('[DEBUG][blocked][constrained]', {
    constrainedBlockedTotal,
  });

  return constrainedBlockedTotal;
}
