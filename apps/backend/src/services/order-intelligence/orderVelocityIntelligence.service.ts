import type { OrderTrendFacts } from
  '../order-facts/orderTrendFacts.service.js';

/**
  * Order Velocity Intelligence (Layer 2)
 *
 * NOTE:
 * - Operates on Layer 1½ facts
 * - Produces classified orientation
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
  facts: OrderTrendFacts,
  dataUsable: boolean | null
): 'up' | 'down' | 'flat' | 'unknown' {

  const { previousWindowOrders, currentWindowOrders } = facts;

  // Epistemic guard — velocity is undefined without usable data
  if (dataUsable !== true) {
    return 'unknown';
  }

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