"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.performNonPCDSync = void 0;
// packages/api/src/services/shopify-fallback.service.ts
const shopify_api_1 = require("@shopify/shopify-api");
require("@shopify/shopify-api/adapters/node");
const db_1 = __importDefault(require("../db"));
// Add required scopes for non-PCD data
const REQUIRED_SCOPES = [
    'read_products',
    'read_inventory'
];
// Initialize the Shopify API library context WITH SCOPES
const shopify = (0, shopify_api_1.shopifyApi)({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    apiVersion: process.env.SHOPIFY_API_VERSION,
    isEmbeddedApp: false,
    hostName: 'localhost',
    scopes: REQUIRED_SCOPES,
});
// Non-PCD queries that should work without special approval
const NON_PCD_QUERIES = {
    products: `
    query products($first: Int!) {
      products(first: $first) {
        edges {
          node {
            id
            title
            vendor
            productType
            status
            totalInventory
            variants(first: 10) {
              edges {
                node {
                  id
                  sku
                  price
                  inventoryQuantity
                }
              }
            }
          }
        }
      }
    }
  `,
    inventory: `
    query inventoryLevels($first: Int!) {
      inventoryLevels(first: $first) {
        edges {
          node {
            id
            available
            location {
              id
              name
            }
          }
        }
      }
    }
  `,
    shop: `
    query {
      shop {
        id
        name
        email
        currencyCode
        plan {
          displayName
        }
      }
    }
  `
};
const performNonPCDSync = async (accessToken, platformShopName, shopId, integrationId) => {
    console.log(`[ShopifyFallback] Starting non-PCD sync for shopId: ${shopId}`);
    const session = new shopify_api_1.Session({
        id: `session-fallback-${shopId}`,
        shop: platformShopName,
        state: 'state',
        isOnline: true,
        accessToken,
    });
    const client = new shopify.clients.Graphql({ session });
    try {
        // Update sync status
        await (0, db_1.default)('integrations').where({ id: integrationId }).update({
            sync_status: 'SYNCING_PRODUCTS',
            sync_last_error: null,
            sync_progress_current: 0,
            sync_progress_total: 3, // products, inventory, shop
        });
        await db_1.default.transaction(async (trx) => {
            // Sync products (non-PCD)
            console.log(`[ShopifyFallback] Syncing products...`);
            const productsResponse = await client.request(NON_PCD_QUERIES.products, {
                variables: { first: 50 }
            });
            await syncProductsFallback(trx, shopId, productsResponse.data.products.edges);
            await trx('integrations').where({ id: integrationId }).update({
                sync_status: 'SYNCING_INVENTORY',
                sync_progress_current: 1,
            });
            // Sync inventory (non-PCD)
            console.log(`[ShopifyFallback] Syncing inventory...`);
            const inventoryResponse = await client.request(NON_PCD_QUERIES.inventory, {
                variables: { first: 50 }
            });
            await syncInventoryFallback(trx, shopId, inventoryResponse.data.inventoryLevels.edges);
            await trx('integrations').where({ id: integrationId }).update({
                sync_status: 'SYNCING_SHOP',
                sync_progress_current: 2,
            });
            // Sync shop info (non-PCD)
            console.log(`[ShopifyFallback] Syncing shop info...`);
            const shopResponse = await client.request(NON_PCD_QUERIES.shop);
            await syncShopInfoFallback(trx, shopId, shopResponse.data.shop);
            await trx('integrations').where({ id: integrationId }).update({
                sync_status: 'COMPLETING',
                sync_progress_current: 3,
            });
        });
        // Mark sync as completed (partial data)
        await (0, db_1.default)('integrations').where({ id: integrationId }).update({
            sync_status: 'COMPLETED_PARTIAL',
            sync_last_error: 'PCD access required for orders and customers',
        });
        console.log(`[ShopifyFallback] Non-PCD sync COMPLETED for shopId: ${shopId}`);
    }
    catch (error) {
        console.error(`[ShopifyFallback] FAILED to sync shopId: ${shopId}`, error);
        await (0, db_1.default)('integrations').where({ id: integrationId }).update({
            sync_status: 'FAILED',
            sync_last_error: error.message,
        });
        throw error;
    }
};
exports.performNonPCDSync = performNonPCDSync;
// Fallback sync functions
async function syncProductsFallback(trx, shopId, edges) {
    const productsToInsert = edges.map(({ node: product }) => ({
        shop_id: shopId,
        platform_product_id: product.id,
        title: product.title,
        vendor: product.vendor,
        product_type: product.productType,
        status: product.status,
        total_inventory: product.totalInventory || 0,
    }));
    if (productsToInsert.length > 0) {
        await trx('shopify_products')
            .insert(productsToInsert)
            .onConflict(['shop_id', 'platform_product_id'])
            .merge();
    }
    console.log(`[ShopifyFallback] Synced ${productsToInsert.length} products`);
}
async function syncInventoryFallback(trx, shopId, edges) {
    const inventoryToInsert = edges.map(({ node: inventory }) => ({
        shop_id: shopId,
        platform_inventory_level_id: inventory.id,
        platform_location_id: inventory.location?.id,
        available_quantity: inventory.available,
        location_name: inventory.location?.name,
    }));
    if (inventoryToInsert.length > 0) {
        await trx('shopify_inventory_levels')
            .insert(inventoryToInsert)
            .onConflict(['shop_id', 'platform_inventory_level_id'])
            .merge();
    }
    console.log(`[ShopifyFallback] Synced ${inventoryToInsert.length} inventory levels`);
}
async function syncShopInfoFallback(trx, shopId, shopData) {
    const shopInfo = {
        shop_id: shopId,
        platform_shop_id: shopData.id,
        name: shopData.name,
        email: shopData.email,
        currency_code: shopData.currencyCode,
        plan_name: shopData.plan?.displayName,
    };
    await trx('shopify_shop_info')
        .insert(shopInfo)
        .onConflict(['shop_id'])
        .merge();
    console.log(`[ShopifyFallback] Synced shop info`);
}
