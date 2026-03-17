import db from '@lasyncro/backend-core/db.js';
import { Knex } from 'knex';

/**
 * SHOPIFY ORDER SYNC SERVICE
 * ---------------------------
 * Responsible ONLY for:
 * - transforming Shopify orders → domain events
 *
 * Guarantees:
 * - idempotency
 * - deterministic replay
 */
export async function syncShopifyOrders({
  trx,
  shopId,
  orderEdges,
}: {
  trx: Knex.Transaction;
  shopId: number;
  orderEdges: any[];
}) {
  let createdCount = 0;
  let duplicateCount = 0;
  
  if (!orderEdges?.length) {
    console.warn('[SHOPIFY_ORDERS_SYNC][DEBUG] No Orders available to be Synced!')
    return
  };

  for (const { node } of orderEdges) {

      const inserted = await trx('domain_events')
        .insert({
            shop_id: shopId,
            event_type: 'orders/sync',
            event_payload: node,
            event_time: new Date(node.createdAt),
            event_version: 1,
            external_event_id: String(node.id),
        })
        .onConflict(
            db.raw('(shop_id, external_event_id) WHERE external_event_id IS NOT NULL')
        )
        .ignore()
        .returning<{ id: number }[]>('id');

      if (inserted.length > 0) {
        createdCount++;
         } else {
        duplicateCount++;
      }
  }

  console.info('[ORDER_SYNC_BATCH_SUMMARY]', {
    shopId,
    created: createdCount,
    duplicates: duplicateCount,
    total: orderEdges.length,
  });
}