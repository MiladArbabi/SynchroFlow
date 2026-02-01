// apps/backend/src/workers/reconciliation/reconciliation.worker.ts

import db from 'api-src/db';
import { reconcileOrderFulfillment } from './reconciliation.handlers';

export async function runFulfillmentReconciliationBatch(
  shopId: number,
  limit = 500
): Promise<void> {

  // 1. Find canonical orders missing execution
  const rows = await db('canonical_orders as o')
  .leftJoin(
    'order_fulfillment_status as f',
    function () {
      this.on('o.canonical_order_id', '=', 'f.canonical_order_id')
          .andOn('o.shop_id', '=', 'f.shop_id');
    }
  )
  .where('o.shop_id', shopId)
  .whereNull('f.canonical_order_id')
  .select('o.canonical_order_id')
  .limit(limit);

  if (rows.length === 0) return;

  // 2. Reconcile each order (serial on purpose)
  for (const row of rows) {
    console.log(
      '[reconciliation][batch]',
      row.canonical_order_id
    );
    await reconcileOrderFulfillment(row.canonical_order_id);
  }
}