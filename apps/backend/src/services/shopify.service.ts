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