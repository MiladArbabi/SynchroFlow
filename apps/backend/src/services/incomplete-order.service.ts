export async function recordIncompleteOrder(payload: {
  shopId: number;
  platform: string;
  platformOrderId: string;
  reason: string;
}) {
  console.warn('[INCOMPLETE_ORDER]', payload);
}
