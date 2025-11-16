// packages/api/src/services/shopify.service.ts
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import db from '../db';
import { Knex } from 'knex';

// 1. Initialize the Shopify API library context
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: process.env.SHOPIFY_API_VERSION as ApiVersion,
  isEmbeddedApp: false,
  hostName: 'localhost', // This doesn't matter for an offline token
});

// 2. The main function to run the sync
export const performInitialSync = async (
  accessToken: string,
  platformShopName: string,
  shopId: number,
  integrationId: number
) => {
  console.log(`[ShopifyService] Starting initial sync for shopId: ${shopId}`);

  // Create a new session for the GraphQL client
  const session = new Session({
    id: `session-sync-${shopId}`,
    shop: platformShopName,
    state: 'state',
    isOnline: true, // Use isOnline: true for offline tokens
    accessToken,
  });

  const client = new shopify.clients.Graphql({ session });

  // MINIMAL, STABLE GraphQL query - only basic fields that exist in all API versions
  const query = `
    query {
      # Fetch Products - basic fields only
      products(first: 50) {
        edges {
          node {
            id
            title
            vendor
            productType
            status
            totalInventory
          }
        }
      }
      
      # Fetch Orders - basic fields only
      orders(first: 50) {
        edges {
          node {
            id
            name
            totalPriceSet { 
              shopMoney { 
                amount 
                currencyCode
              } 
            }
            currencyCode
            createdAt
            # Remove fulfillments for now to simplify
          }
        }
      }
      
      # Fetch basic shop info
      shop {
        id
        name
        email
        currencyCode
        timezoneOffset
      }
    }
  `;

  try {
    console.log(`[ShopifyService] Making GraphQL request to Shopify...`);
    const response = await client.request(query);
    const data = response.data as any;
    console.log(`[ShopifyService] GraphQL response received, data keys:`, Object.keys(data));

    const totalProducts = data.products?.edges.length || 0;
    const totalOrders = data.orders?.edges.length || 0;
    const totalProgress = totalProducts + totalOrders;
    // --- 1. Report: STARTING (Products) ---
    await db('integrations').where({ id: integrationId }).update({
      sync_status: 'SYNCING_PRODUCTS',
      sync_last_error: null,
      sync_progress_current: 0,
      sync_progress_total: totalProgress,
    });

    // 4. Use a transaction to sync all data or none
    await db.transaction(async (trx) => {
      if (data.products) {
        console.log(`[ShopifyService] Syncing ${data.products.edges.length} products...`);
        await syncProducts(trx, shopId, data.products.edges);
        
        // --- 2. Report: SYNCING_ORDERS ---
        await trx('integrations').where({ id: integrationId }).update({
          sync_status: 'SYNCING_ORDERS',
          sync_progress_current: totalProducts,
        });
      }

      if (data.orders) {
        console.log(`[ShopifyService] Syncing ${data.orders.edges.length} orders...`);
        await syncOrders(trx, shopId, data.orders.edges);
        
        // --- 3. Report: COMPLETING ---
        await trx('integrations').where({ id: integrationId }).update({
          sync_status: 'COMPLETING',
          // Current progress is now all products + all orders
          sync_progress_current: totalProgress,
        });
      }
    });

    // --- 4. Report: COMPLETED ---
    await db('integrations').where({ id: integrationId }).update({
      sync_status: 'COMPLETED',
      sync_last_error: null,
    });

    console.log(`[ShopifyService] Sync COMPLETED for shopId: ${shopId}`);
  } catch (error: any) {
    console.error(`[ShopifyService] FAILED to sync shopId: ${shopId}`, error);
    console.error(`[ShopifyService] Error details:`, error.response?.errors || error.message);
    
    // Update integration status to FAILED
    await db('integrations').where({ id: integrationId }).update({
      sync_status: 'FAILED',
      sync_last_error: error.message,
    });
    
    throw error;
  }
};

// Simplified sync functions
async function syncProducts(trx: Knex.Transaction, shopId: number, edges: any[]) {
  const productsToInsert = edges.map(({ node }: any) => ({
    shop_id: shopId,
    platform_product_id: node.id,
    title: node.title,
    vendor: node.vendor,
    product_type: node.productType,
    status: node.status,
    total_inventory: node.totalInventory || 0,
  }));

  if (productsToInsert.length > 0) {
    await trx('shopify_products')
      .insert(productsToInsert)
      .onConflict(['shop_id', 'platform_product_id'])
      .merge();
    console.log(`[ShopifyService] Synced ${productsToInsert.length} products.`);
  }
};

// Simplified orders sync without fulfillments
async function syncOrders(trx: Knex.Transaction, shopId: number, edges: any[]) {
  const ordersToInsert = edges.map(({ node }: any) => ({
    shop_id: shopId,
    platform_order_id: node.id,
    order_number: node.name,
    total_price: node.totalPriceSet?.shopMoney?.amount || 0,
    currency: node.currencyCode,
    created_at: node.createdAt,
    // Remove fulfillment_status and financial_status for now
    fulfillment_status: null,
    financial_status: null,
  }));

  if (ordersToInsert.length > 0) {
    await trx('orders')
      .insert(ordersToInsert)
      .onConflict('platform_order_id')
      .merge();
    console.log(`[ShopifyService] Synced ${ordersToInsert.length} orders.`);
  }
}

async function syncOrdersAndFulfillments(trx: Knex.Transaction, shopId: number, edges: any[]) {
  const ordersToInsert = [];
  const fulfillmentsToInsert = [];

  for (const { node } of edges) {
    ordersToInsert.push({
      shop_id: shopId,
      platform_order_id: node.id,
      order_number: node.name,
      fulfillment_status: node.fulfillmentStatus,
      financial_status: node.financialStatus,
      total_price: node.totalPriceSet.shopMoney.amount,
      currency: node.currencyCode,
      // We must get customer_id later. For now, we need to make it nullable or use a default.
      // Let's assume the table was modified to make customer_id nullable for now.
      // customer_id: null, // <-- IMPORTANT
    });

    for (const fulfillment of node.fulfillments) {
      fulfillmentsToInsert.push({
        shop_id: shopId,
        platform_fulfillment_id: fulfillment.id,
        platform_order_id: node.id, // Link back to the order
        status: fulfillment.status,
        tracking_company: fulfillment.trackingInfo?.[0]?.company,
        tracking_number: fulfillment.trackingInfo?.[0]?.number,
        total_shipping_cost: 0, // STUB: Shipping cost is hard to get. We'll add this later.
      });
    }
  }

  if (ordersToInsert.length > 0) {
    // Note: This assumes 'customer_id' in 'orders' table is nullable
    // If not, this migration will fail and we must alter the table.
    await trx('orders')
      .insert(ordersToInsert)
      .onConflict('platform_order_id')
      .merge();
    console.log(`[ShopifyService] Synced ${ordersToInsert.length} orders.`);
  }

  if (fulfillmentsToInsert.length > 0) {
    await trx('shopify_fulfillments')
      .insert(fulfillmentsToInsert)
      .onConflict(['shop_id', 'platform_fulfillment_id'])
      .merge();
    console.log(`[ShopifyService] Synced ${fulfillmentsToInsert.length} fulfillments.`);
  }
}

async function syncPayouts(trx: Knex.Transaction, shopId: number, edges: any[]) {
  const payoutsToInsert = edges.map(({ node }: any) => ({
    shop_id: shopId,
    platform_payout_id: node.id,
    status: node.status,
    date: node.date,
    currency: node.currency,
    amount: node.amount,
    fees: node.fee,
    net_amount: node.netAmount,
  }));

  if (payoutsToInsert.length > 0) {
    await trx('shopify_payouts')
      .insert(payoutsToInsert)
      .onConflict(['shop_id', 'platform_payout_id'])
      .merge();
    console.log(`[ShopifyService] Synced ${payoutsToInsert.length} payouts.`);
  }
}