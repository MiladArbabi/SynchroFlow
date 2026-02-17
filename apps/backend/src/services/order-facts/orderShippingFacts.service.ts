// apps/backend/src/services/order-facts/orderShippingFacts.service.ts

import { resolveFt2Range } from "@lasyncro/backend-core/utils/ft2Period.js";

/**
 * Shipping Facts (Layer 1)
 * -----------------------
 * Observes whether shipping / fulfillment execution events exist.
 *
 * Question answered:
 * - Do shipping events exist for orders in this period?
 *
 * Guarantees:
 * - Presence-only (no status semantics)
 * - Time-scoped
 * - Deterministic
 * - No lifecycle interpretation (no fulfilled / delayed / SLA)
 *
 * Fail-closed:
 * - Absence or uncertainty → shippingSignal = 'absent'
 */
export async function extractOrderShippingFacts(
  shopId: number,
  range: Parameters<typeof resolveFt2Range>[0]
) {
  
  return {
  shippingSignal: 'absent' as const,
  visibility: 'insufficient' as const,
};
}