// apps/backend/src/workers/reconciliation/reconciliation.worker.ts

import db from 'api-src/db';
import { reconcileOrderFulfillment } from './reconciliation.handlers';

export async function runFulfillmentReconciliationBatch(
  limit = 500
): Promise<void> {

  // 1. Find canonical orders missing execution
  const rows = await db('canonical_orders as o')
    .leftJoin(
      'order_fulfillment_status as f',
      'o.canonical_order_id',
      'f.canonical_order_id'
    )
    .whereNull('f.canonical_order_id')
    .select('o.canonical_order_id')
    .limit(limit);

  if (rows.length === 0) return;

  // 2. Reconcile each order (serial on purpose)
  for (const row of rows) {
    await reconcileOrderFulfillment(row.canonical_order_id);
  }
}