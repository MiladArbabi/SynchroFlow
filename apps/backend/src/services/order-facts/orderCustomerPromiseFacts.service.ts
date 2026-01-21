// apps/backend/src/services/order-facts/orderCustomerPromiseFacts.service.ts

/**
 * Customer Promise Facts (Layer 1)
 * --------------------------------
 * Customer delivery promises are NOT currently represented
 * in the canonical orders schema.
 *
 * There is no factual column (e.g. delivery_date, promised_at, SLA)
 * that can be used to assert promise presence.
 *
 * Therefore:
 * - Promise presence cannot be asserted
 * - No database queries are executed
 * - The system fails closed by design
 *
 * This is correct for FT2.
 */
export async function extractOrderCustomerPromiseFacts(
  _shopId: number,
  _range: unknown
) {
  return {
    promiseSignal: 'absent' as const,
    visibility: 'insufficient' as const,
  };
}
