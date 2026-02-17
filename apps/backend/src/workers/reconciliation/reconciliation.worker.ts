// apps/backend/src/workers/reconciliation/reconciliation.worker.ts

import db from '@lasyncro/backend-core/db.js';
import { reconcileOrderFulfillment } from './reconciliation.handlers.js';
import { rebuildInventoryProjection } from '../../services/inventory/rebuildInventoryProjection.js';

export async function runFulfillmentReconciliationBatch(
  shopId: number,
  limit = 500
): Promise<void> {

  /**
   * DELTA-BASED RECONCILIATION SELECTION
   * ------------------------------------
   * Only reconcile orders that:
   *   - Have never been reconciled
   *   - OR have been updated since last reconciliation
   *
   * Prevents full-dataset rewrites.
   */
  const rows = await db('orders')
    .where('shop_id', shopId)
    .andWhere(function () {
      this.whereNull('last_reconciled_at')
          .orWhere('order_updated_at', '>', db.ref('last_reconciled_at'));
    })
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

      await db('orders')
        .where({ lasyncro_order_id: row.lasyncro_order_id })
        .update({ last_reconciled_at: db.fn.now() });
    }

    // 🔁 Deterministic projection rebuild after batch
    await rebuildInventoryProjection();
  }
