// apps/backend/src/workers/reconciliation/reconciliation.worker.ts

import db from 'api-src/db';
import { reconcileOrderFulfillment } from './reconciliation.handlers';

export async function runFulfillmentReconciliationBatch(
  shopId: number,
  limit = 500
): Promise<void> {

  // 1. Find sovereign orders for shop
  const rows = await db('orders')
    .where('shop_id', shopId)
    .select('lasyncro_order_id', 'order_processed_at')
    .orderBy('order_created_at', 'asc')
    .limit(limit);

  if (rows.length === 0) return;

  // 2. Reconcile each order (serial)
  for (const row of rows) {

    await reconcileOrderFulfillment(
      row.lasyncro_order_id,
      row.order_processed_at
        ? {
            status: 'fulfilled',
            observedAt: row.order_processed_at,
            source: 'shopify_sync',
          }
        : undefined
    );
  }
}
