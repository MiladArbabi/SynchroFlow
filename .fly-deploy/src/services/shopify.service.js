"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.performInitialSync = void 0;
// packages/api/src/services/shopify.service.ts
const shopify_api_1 = require("@shopify/shopify-api");
require("@shopify/shopify-api/adapters/node");
const db_1 = __importDefault(require("../db"));
// 1. Initialize the Shopify API library context
const shopify = (0, shopify_api_1.shopifyApi)({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    apiVersion: process.env.SHOPIFY_API_VERSION,
    isEmbeddedApp: false,
    hostName: 'localhost', // This doesn't matter for an offline token
});
// 2. The main function to run the sync
const performInitialSync = async (accessToken, platformShopName, shopId, integrationId) => {
    console.log(`[ShopifyService] Starting initial sync for shopId: ${shopId}`);
    // Create a new session for the GraphQL client
    const session = new shopify_api_1.Session({
        id: `session-sync-${shopId}`,
        shop: platformShopName,
        state: 'state',
        isOnline: true, // Use isOnline: true for offline tokens
        accessToken,
    });
    const client = new shopify.clients.Graphql({ session });
    // 3. Define ONE giant GraphQL query for efficiency
    // We fetch the last 50 of each for the MVP.
    const query = `
    query {
      shop {
        paymentGateways
      }
      
      # Fetch Products
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
      
      # Fetch Orders (and their fulfillments)
      orders(first: 50) {
        edges {
          node {
            id
            name
            fulfillmentStatus
            financialStatus
            totalPriceSet { shopMoney { amount } }
            currencyCode
            
            # Fetch fulfillments for THIS order
            fulfillments(first: 10) {
              id
              status
              trackingInfo { company, number }
              # We will get shipping cost from the Order itself for now
              # This API is complex, so we'll stub shipping cost
            }
          }
        }
      }
      
      # Fetch Payouts (for fees)
      payouts(first: 50) {
        edges {
          node {
            id
            status
            date
            currency
            amount
            fee
            netAmount
          }
        }
      }
    }
  `;
    try {
        // --- 1. Report: STARTING (Products) ---
        await (0, db_1.default)('integrations').where({ id: integrationId }).update({
            sync_status: 'SYNCING_PRODUCTS',
            sync_last_error: null,
            sync_progress_current: 0,
            sync_progress_total: 0, // We'll estimate this soon
        });
        const response = await client.request(query);
        const data = response.data; // Cast to 'any' to access dynamic keys
        // 4. Use a transaction to sync all data or none
        await db_1.default.transaction(async (trx) => {
            if (data.products) {
                await syncProducts(trx, shopId, data.products.edges);
                // --- 2. Report: SYNCING_ORDERS ---
                await trx('integrations').where({ id: integrationId }).update({
                    sync_status: 'SYNCING_ORDERS',
                    sync_progress_total: data.products.edges.length, // MVP: Total is product count
                    sync_progress_current: data.products.edges.length, // We've finished products
                });
            }
            if (data.orders) {
                await syncOrdersAndFulfillments(trx, shopId, data.orders.edges);
                // --- 3. Report: SYNCING_FINANCES ---
                const totalProgress = (data.products?.edges.length || 0) + (data.orders?.edges.length || 0);
                await trx('integrations').where({ id: integrationId }).update({
                    sync_status: 'SYNCING_FINANCES',
                    sync_progress_total: totalProgress, // This is an estimate, good enough for MVP
                    sync_progress_current: totalProgress,
                });
            }
            if (data.payouts) {
                await syncPayouts(trx, shopId, data.payouts.edges);
            }
        });
        // --- Report: COMPLETED (and save discovered data) ---
        const discoveredGateways = data.shop?.paymentGateways
            ? JSON.stringify(data.shop.paymentGateways)
            : null;
        // --- 4. Report: COMPLETED ---
        await (0, db_1.default)('integrations').where({ id: integrationId }).update({
            sync_status: 'COMPLETED',
            sync_last_error: null,
            discovered_payment_gateways: discoveredGateways
        });
        console.log(`[ShopifyService] Sync COMPLETED for shopId: ${shopId}`);
    }
    catch (error) {
        console.error(`[ShopifyService] FAILED to sync shopId: ${shopId}`, error.response?.errors || error);
        throw error; // Re-throw to make the worker nack the message
    }
};
exports.performInitialSync = performInitialSync;
// --- Data Sync Helper Functions ---
async function syncProducts(trx, shopId, edges) {
    const productsToInsert = edges.map(({ node }) => ({
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
            .onConflict(['shop_id', 'platform_product_id']) // If product exists
            .merge(); // Update it
        console.log(`[ShopifyService] Synced ${productsToInsert.length} products.`);
    }
}
async function syncOrdersAndFulfillments(trx, shopId, edges) {
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
async function syncPayouts(trx, shopId, edges) {
    const payoutsToInsert = edges.map(({ node }) => ({
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
