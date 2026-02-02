// apps/backend/src/workers/fulfillment-reconciliation.worker.ts

import db from 'api-src/db';
import OrderFulfillmentIngestionService
  from 'api-src/services/order-fulfillment-ingestion/orderFulfillmentIngestion.service';

/**
 * Fulfillment Reconciliation Worker
 * --------------------------------
 * Purpose:
 * - Materialize missing execution truth for canonical orders
 *
 * Guarantees:
 * - Never writes without canonical identity
 * - Never overwrites observed execution
 * - Idempotent and replay-safe
 *
 * This worker is REQUIRED for FT2 stability.
 */

export async function runFulfillmentReconciliation(limit = 500) {
  const rows = await db('canonical_orders as co')
    .leftJoin(
      'order_fulfillment_status as ofs',
      'ofs.canonical_order_id',
      'co.canonical_order_id'
    )
    .whereNull('ofs.id')
    .select(
      'co.shop_id',
      'co.canonical_order_id',
      'co.platform_order_id'
    )
    .limit(limit);

  for (const row of rows) {
    await OrderFulfillmentIngestionService.synthesizeExecution({
      shopId: row.shop_id,
      canonicalOrderId: row.canonical_order_id,
      platformOrderId: row.platform_order_id,
    });
  }

  return {
    reconciled: rows.length,
  };
}
