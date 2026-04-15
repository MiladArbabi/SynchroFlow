export function extractExternalOrderId(
  eventType: string,
  payload: any
): string | null {
  if (!eventType.startsWith('orders/')) {
    throw new Error(
      `[UNSUPPORTED_EVENT_TYPE_FOR_ORDER_ID] ${eventType}`
    );
  }

  if (
    eventType === 'orders/fulfilled' ||
    eventType === 'orders/fulfillment_updated'
  ) {
    return payload?.order_id ?? null;
  }

  return payload?.id ?? payload?.order_id ?? null;
}

/**
 * DEBUG LOG GUARD
 * ---------------
 * console.debug() is NOT silent by default in Node.js — it outputs to stdout
 * unconditionally. Use this utility instead of raw console.debug() for any
 * per-entity/per-event trace logs that should be silent in normal operation.
 *
 * To enable debug logs: set DEBUG_PROJECTION=1 in your .env
 */
export function debugLog(label: string, data?: Record<string, unknown>): void {
  if (process.env.DEBUG_PROJECTION === '1') {
    console.log(label, data ?? '');
  }
}