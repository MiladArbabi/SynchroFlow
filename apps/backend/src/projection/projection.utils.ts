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