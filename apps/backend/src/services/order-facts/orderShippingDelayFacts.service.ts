// apps/backend/src/services/order-facts/orderShippingDelayFacts.service.ts

/**
 * Shipping Delay Facts (Layer 1)
 * -----------------------------
 * Shipping delay is NOT currently a first-class factual signal.
 *
 * The underlying schema (shopify_fulfillments) does NOT record
 * delay, breach, or SLA violations.
 *
 * Therefore:
 * - No delay presence can be asserted
 * - No queries are executed
 * - The system fails closed by design
 *
 * This is intentional and correct for FT2.
 */
export async function extractOrderShippingDelayFacts(
  _shopId: number,
) {
  return {
    delaySignal: 'absent' as const,
    visibility: 'insufficient' as const,
  };
}