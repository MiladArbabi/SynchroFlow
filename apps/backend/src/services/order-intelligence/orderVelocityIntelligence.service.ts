import type { OrderTrendFacts } from
  '../order-facts/orderTrendFacts.service';

/**
 * Order Velocity Intelligence (Layer 1½)
 * -------------------------------------
 * Pure comparison of order creation counts
 * across two adjacent time windows.
 *
 * Rules:
 * - Counts only
 * - No thresholds
 * - No trend strength
 * - Fail closed
 */
export function deriveOrderVelocityReality(
  facts: OrderTrendFacts
): 'up' | 'down' | 'flat' | 'unknown' {

  const { previousWindowOrders, currentWindowOrders } = facts;

  if (
    previousWindowOrders === null ||
    currentWindowOrders === null ||
    previousWindowOrders === 0
  ) {
    return 'unknown';
  }

  if (currentWindowOrders > previousWindowOrders) return 'up';
  if (currentWindowOrders < previousWindowOrders) return 'down';
  return 'flat';
}