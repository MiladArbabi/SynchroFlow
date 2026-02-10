// apps/backend/src/workers/reconciliation/reconciliation.worker.ts
import db from 'api-src/db';
import { reconcileOrderFulfillment } from './reconciliation.handlers';

export async function runFulfillmentReconciliationBatch(
  shopId: number,
  limit = 500
): Promise<void> {

  // 1. Find canonical orders missing execution
  const rows = await db('canonical_orders')
    .where('shop_id', shopId)
    .select('canonical_order_id')
    .limit(limit);

  if (rows.length === 0) return;

  // 2. Reconcile each order (serial on purpose)
  for (const row of rows) {
    console.log(
      '[reconciliation][batch]',
      row.canonical_order_id
    );
    const order = await db('canonical_orders')
      .where({ canonical_order_id: row.canonical_order_id })
      .first();

    await reconcileOrderFulfillment(
      row.canonical_order_id,
      order?.order_processed_at
        ? {
            status: 'delivered',
            observedAt: order.order_processed_at,
            source: 'shopify_sync',
          }
        : undefined
    );
  }
}