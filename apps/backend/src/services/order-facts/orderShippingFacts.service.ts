// apps/backend/src/services/order-facts/orderShippingFacts.service.ts
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
) {
  
  return {
  shippingSignal: 'absent' as const,
  visibility: 'insufficient' as const,
};
}