import db from '@lasyncro/backend-core/db.js';
import { Knex } from 'knex';
import { backfillFulfillmentEvent }
  from '../fulfillment/fulfillmentBackfill.service.js';

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
  orderEdges
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

      /**
       * ORDER ID NORMALIZATION
       * -----------------------
       * Must match identity map format (numeric ID)
       */
      let externalOrderId = String(node.id);

      if (externalOrderId.startsWith('gid://')) {
        const parts = externalOrderId.split('/');
        externalOrderId = parts[parts.length - 1];
      }

      /**
       * INVARIANT ENFORCEMENT — NO GID ALLOWED
       * --------------------------------------
       * Domain events MUST NEVER contain Shopify GIDs.
       * If this triggers, ingestion is broken.
       */
      if (String(node.id).startsWith('gid://') && externalOrderId === node.id) {
        throw new Error(
          '[INGESTION_INVARIANT_VIOLATION] Failed to normalize Shopify Order ID'
        );
      }

      const inserted = await trx('domain_events')
        .insert({
            shop_id: shopId,
            event_type: 'orders/sync',
            /**
             * CANONICAL ORDER PAYLOAD
             * ------------------------
             * Enforces normalized identity at ingestion boundary.
             *
             * CRITICAL:
             * - Prevents GID leakage into domain events
             * - Guarantees deterministic replay
             */
            event_payload: {
              ...node,
              id: externalOrderId,
            },
            event_time: new Date(node.createdAt),
            event_version: 1,
            /**
             * EXTERNAL EVENT ID NORMALIZATION (GID → NUMERIC)
             */
            external_event_id: (() => {
              let id = String(node.id);

              if (id.startsWith('gid://')) {
                id = id.split('/').pop()!;
              }

              return id;
            })(),
        })
        .onConflict(
            db.raw('(shop_id, external_event_id) WHERE external_event_id IS NOT NULL')
        )
        .ignore()
        .returning<{ id: number }[]>('id')
        .then((res) => {
          if (res.length === 0) {
            console.debug('[INGESTION_DUPLICATE_SKIPPED]', {
              entity: 'shopify_order_event',
              reason: 'external_event_id dedup'
            });
          }
          return res;
        });

      if (inserted.length > 0) {
        createdCount++;

        /**
         * INGESTION SIGNAL — FIRST ORDER SYNC
         * -----------------------------------
         * Uses canonical ingestion schema:
         * - module_id = 'orders'
         * - event     = 'sync_started'
         *
         * This avoids schema drift and preserves
         * compatibility with existing ingestion model.
         */
        await trx('shop_ingestion_events')
          .insert({
            shop_id: shopId,
            module_id: 'orders',
            event: 'sync_started',
            created_at: trx.fn.now(),
          })
          .onConflict(['shop_id', 'module_id', 'event'])
          .ignore()
          .returning<{ id: number }[]>('id')
          .then((res) => {
            if (res.length === 0) {
              console.debug('[INGESTION_DUPLICATE_SKIPPED]', {
                entity: 'shopify_order_event',
                reason: 'external_event_id dedup'
              });
            }
            return res;
          });

        console.info('[INGESTION_SIGNAL_EMITTED]', {
          shopId,
          module: 'orders',
          event: 'sync_started',
        });

                /**
         * DOMAIN EVENT — INGESTION STARTED
         * --------------------------------
         * This is the ONLY valid bridge to lifecycle.
         *
         * Lifecycle must NEVER read tables directly.
         */
        await trx('domain_events')
          .insert({
            shop_id: shopId,
            event_type: 'orders/sync_started',
            event_payload: {},
            event_time: trx.fn.now(),
            event_version: 1,
            external_event_id: `orders_sync_started:${shopId}`,
          })
          .onConflict(
            db.raw('(shop_id, external_event_id) WHERE external_event_id IS NOT NULL')
          )
          .ignore()
          .returning<{ id: number }[]>('id')
          .then((res) => {
            if (res.length === 0) {
              console.debug('[INGESTION_DUPLICATE_SKIPPED]', {
                entity: 'shopify_order_event',
                reason: 'external_event_id dedup'
              });
            }
            return res;
          });

        console.info('[INGESTION_DOMAIN_EVENT_EMITTED]', {
          shopId,
          event: 'orders/sync_started',
        });
        
        } else {
        duplicateCount++;
      }

      /**
       * FULFILLMENT BACKFILL (IDEMPOTENT GUARD)
       * ----------------------------------------
       * Only emit if fulfillment status exists AND
       * no prior fulfillment event has been recorded.
       */
      if (
        node.fulfillmentStatus ||
        node.displayFulfillmentStatus
      ) {
        await backfillFulfillmentEvent({
          shopId,
          orderId: externalOrderId,
          fulfillmentStatus:
            node.fulfillmentStatus ??
            node.displayFulfillmentStatus ??
            null,
          eventTime: new Date(node.updatedAt ?? node.createdAt),
        });
      }

      /**
       * PAYMENT EVENT EMISSION (INGESTION LAYER)
       * -----------------------------------------
       * MUST happen here (not projection) to preserve:
       * - deterministic replay
       * - projection purity
       */
      const financialStatus =
        node.financial_status?.toLowerCase() ??
        node.displayFinancialStatus?.toLowerCase();

      if (financialStatus === 'paid') {
        await trx('domain_events')
          .insert({
            shop_id: shopId,
            event_type: 'orders/paid',
            event_payload: {
              id: externalOrderId,
            },
            event_time: new Date(node.createdAt),
            event_version: 1,
            external_event_id: (() => {
              let id = String(node.id);

              if (id.startsWith('gid://')) {
                id = id.split('/').pop()!;
              }

              return `${id}:paid`;
            })(),
          })
          .onConflict(
            db.raw('(shop_id, external_event_id) WHERE external_event_id IS NOT NULL')
          )
          .ignore()
          .returning<{ id: number }[]>('id')
          .then((res) => {
            if (res.length === 0) {
              console.debug('[INGESTION_DUPLICATE_SKIPPED]', {
                entity: 'shopify_order_event',
                reason: 'external_event_id dedup'
              });
            }
            return res;
          });

        /* console.debug('[ORDER_SYNC_EMITTED_PAID]', {
          orderId: node.id,
        }); */
      }
  }

  console.info('[ORDER_SYNC_BATCH_SUMMARY]', {
    shopId,
    created: createdCount,
    duplicates: duplicateCount,
    total: orderEdges.length,
  });
}