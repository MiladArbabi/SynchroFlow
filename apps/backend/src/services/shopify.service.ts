// apps/backend/src/services/shopify.service.ts
import db from '@lasyncro/backend-core/db.js';
import { createShopifyGraphQLClient } from './shopify/shopifyClient.service.js';
import { GET_PRODUCTS_QUERY, GET_ORDERS_QUERY } from './shopify/shopify.queries.js';
import { paginateShopify } from './shopify/shopifyPagination.service.js';
import { registerWebhooksForShop } from './shopify/shopifyWebhook.service.js';
import { syncShopifyProducts } from './shopify/shopifyProductSync.service.js';
import { updateIntegrationStatus } from './shopify/shopifyIntegrationStatus.service.js';

import { syncShopifyOrders } from './shopify/shopifyOrderSync.service.js';

export const performInitialSync = async (
  accessToken: string,
  platformShopName: string,
  shopId: number,
  integrationId: number
) => {

  const syncStart = Date.now();

  console.info('[SHOPIFY_SYNC_STARTED]', {
    shopId,
    integrationId,
  });

  console.log(`[ShopifyService] Starting initial sync for shopId: ${shopId}`);

  /**
   * HARD GUARD — Prevent illegal re-sync
   *
   * Once COMPLETED, sync must not restart.
   * DB enforces this invariant — we mirror it here.
   */
  const integration = await db('integrations')
    .where({ id: integrationId })
    .first();

  if (integration?.sync_status === 'COMPLETED') {
    console.warn('[SHOPIFY_SYNC_SKIPPED_ALREADY_COMPLETED]', {
      shopId,
      integrationId,
    });

    return;
  }

  const client = createShopifyGraphQLClient({
    accessToken,
    platformShopName,
    shopId,
  });

  const productsQuery = GET_PRODUCTS_QUERY;
  const ordersQuery = GET_ORDERS_QUERY;

  try {
    console.log(`[ShopifyService] Making GraphQL request to Shopify...`);
    const response = await client.request(productsQuery);
    const data = response.data as any;
    const totalProducts = data.products?.edges.length || 0;
    const totalOrders = 0;
    const totalLineItems = 0;

    const totalProgress = totalProducts + totalOrders + totalLineItems;
    // --- Report: STARTING (Products) ---
    await updateIntegrationStatus({
      integrationId,
      status: 'SYNCING_PRODUCTS',
      progressCurrent: 0,
      progressTotal: totalProgress,
      error: null,
    });

    /**
     * PRODUCT SYNC TRANSACTION
     * ------------------------
     * Isolated from order ingestion to prevent:
     * - cross-domain rollback coupling
     * - unnecessary contention
     */
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      if (data.products) {
        await syncShopifyProducts({
          trx,
          shopId,
          integrationId,
          accessToken,
          platformShopName,
          products: data.products.edges,
        });
      }
    });

    /**
     * OPENING BALANCE SEEDING (POST-PRODUCT-SYNC)
     * -------------------------------------------
     * MUST run after product + identity mappings are committed.
     * Runs outside transaction to:
     * - guarantee visibility of committed mappings
     * - avoid rollback coupling with product ingestion
     */
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      const { seedShopifyOpeningBalances } = await import(
        './inventory/seedShopifyOpeningBalances.js'
      );
      await seedShopifyOpeningBalances(
        trx,
        accessToken,
        platformShopName,
        shopId
      );

      /**
       * INVENTORY TRUTH REBUILD (C-05)
       * ------------------------------
       * After opening balances are seeded into inventory_movements,
       * immediately rebuild inventory_truth for all shop variants.
       *
       * This ensures:
       * - inventory_truth is populated on first sync
       * - inventoryConstraintEvaluator has data to work with
       * - Out of Stock swimlane in Fulfillment Queue renders correctly
       * - WMS-lite physical execution layer has accurate stock state
       *
       * eventAnchor = now() for initial sync (no reconciliation event)
       */
      const { rebuildInventoryProjectionForVariants } = await import(
        './inventory/rebuildInventoryProjection.js'
      );

      const variantRows = await trx('variants')
        .where({ shop_id: shopId })
        .select('lasyncro_variant_id');

      const variantIds = variantRows.map((r: { lasyncro_variant_id: string }) =>
        r.lasyncro_variant_id
      );

      if (variantIds.length > 0) {
        await rebuildInventoryProjectionForVariants(
          shopId,
          variantIds,
          trx,
          new Date()
        );

        console.info('[INVENTORY_TRUTH_SEEDED]', {
          shopId,
          variantCount: variantIds.length,
        });
      }
    });

    await updateIntegrationStatus({
      integrationId,
      status: 'SYNCING_ORDERS',
      progressCurrent: totalProducts,
    });

    /**
     * ORDER SYNC TRANSACTION (ISOLATED)
     * ---------------------------------
     * Prevents product sync failures from affecting order ingestion.
     */
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      let totalOrdersIngested = 0;

      await paginateShopify({
        shopId,
        fetchPage: async (cursor) => {
          const variables = cursor ? { cursor } : {};
          const response = await client.request(ordersQuery, { variables });
          return response.data;
        },
        handlePage: async (page) => {
          const orderEdges = page.orders.edges;
          totalOrdersIngested += orderEdges.length;

          await syncShopifyOrders({
            trx,
            shopId,
            orderEdges,
          });

          const dbOrderCount = await db('orders')
            .where({ shop_id: shopId })
            .count('* as count')
            .first();

          console.info('[SHOPIFY_ORDER_COUNT_VERIFICATION]', {
            shopId,
            ingested: totalOrdersIngested,
            dbCount: dbOrderCount?.count,
          });
        },
      });

      console.info('[SHOPIFY_ORDER_SYNC_TOTAL]', {
        shopId,
        totalOrdersIngested,
      });
    });

    console.info('[SHOPIFY_SYNC_COMPLETED]', {
      shopId,
      integrationId,
      durationMs: Date.now() - syncStart,
    });

    // --- Report: COMPLETED ---
    await updateIntegrationStatus({
      integrationId,
      status: 'COMPLETED',
      error: null,
    });

    console.log(`[ShopifyService] Sync COMPLETED for shopId: ${shopId}`);

    /**
     * HISTORICAL REFUND BACKFILL (POST-ORDER-SYNC)
     * --------------------------------------------
     * Webhooks only deliver future refunds.
     * Must run after orders are ingested AND projected —
     * external_order_identity_map is populated by projection,
     * not by sync. Poll until projection catches up before backfill.
     * Fire-and-forget — never block sync completion.
     */
    (async () => {
      try {
        const { backfillShopifyRefunds } = await import(
          './shopify/shopifyRefundBackfill.service.js'
        );

        // Wait for projection to catch up — poll every 2s, max 60s
        const latestEvent = await db('domain_events')
          .where({ shop_id: shopId })
          .orderBy('id', 'desc')
          .select('id')
          .first();

        if (latestEvent?.id) {
          const targetEventId = Number(latestEvent.id);
          const maxWaitMs = 60_000;
          const pollMs = 2_000;
          const start = Date.now();

          while (Date.now() - start < maxWaitMs) {
            const cursor = await db('projection_cursors')
              .where({ projection_name: 'orders_projection' })
              .select('last_processed_event_id')
              .first();

            const processed = Number(cursor?.last_processed_event_id ?? 0);
            if (processed >= targetEventId) break;

            console.info('[REFUND_BACKFILL_AWAITING_PROJECTION]', {
              shopId,
              processed,
              target: targetEventId,
            });
            await new Promise(r => setTimeout(r, pollMs));
          }
        }

        const result = await backfillShopifyRefunds(shopId);
        console.info('[REFUND_BACKFILL_POST_SYNC]', result);
      } catch (err) {
        console.error('[REFUND_BACKFILL_POST_SYNC_FAILED]', {
          error: (err as Error).message,
        });
      }
    })();

    /**
     * WEBHOOK REGISTRATION (ISOLATED SIDE-EFFECT)
     */
    await registerWebhooksForShop(shopId);

    } catch (error: any) {
    console.error(`[ShopifyService] FAILED to sync shopId: ${shopId}`, error);
    console.error(`[ShopifyService] Error details:`, error.response?.errors || error.message);
    
    console.error('[SHOPIFY_SYNC_FAILED]', {
      shopId,
      integrationId,
      durationMs: Date.now() - syncStart,
      error: error.message,
    });

    console.error('[SHOPIFY_GRAPHQL_ERROR]', {
      shopId,
      errors: error?.response?.errors,
    });

    // Update integration status to FAILED
    await updateIntegrationStatus({
      integrationId,
      status: 'FAILED',
      error: error.message,
    });
    
    throw error;
  }
};