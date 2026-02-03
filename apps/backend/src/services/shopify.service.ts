// apps/backend/src/services/shopify.service.ts
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import db from '../db';
import { Knex } from 'knex';
import CanonicalCommerceIngestionService
  from './canonical-commerce-ingestion.service';
import { mapShopifyOrderNodeToCanonical }
  from './mappers/shopify-to-canonical-order';
import { enqueueProductForIngestion } 
  from './product-ingestion.service';
import { recordIncompleteOrder } from './incomplete-order.service';
import { publishReconciliationJob } from 'api-src/queues/reconciliation.queue';

/**
 * IMPORTANT — EXECUTION SEMANTICS
 * ------------------------------
 * This service MUST NOT write to order_fulfillment_status.
 *
 * Fulfillment execution truth is produced exclusively via:
 *   Shopify Webhooks → integration_webhook_events → Queue →
 *   Fulfillment Reconciliation Worker.
 *
 * Any execution writes here will corrupt canonical identity.
 */

// Add required scopes for Protected Customer Data
const REQUIRED_SCOPES = [
  'read_orders',
  'read_customers', 
  'read_products',
  'read_inventory',
  'read_fulfillments'
];

// Initialize the Shopify API library context WITH SCOPES
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: process.env.SHOPIFY_API_VERSION as ApiVersion,
  isEmbeddedApp: false,
  hostName: 'localhost',
  scopes: REQUIRED_SCOPES, 
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
    products(first: 50) {
      edges {
        node {
          id
          title
          vendor
          productType
          status
          totalInventory

          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
              }
            }
          }
        }
      }
    }

    orders(first: 50) {
      edges {
        node {
          id
          name
          createdAt
          updatedAt
          processedAt

          subtotalPriceSet {
            shopMoney { amount }
          }
          totalTaxSet {
            shopMoney { amount }
          }
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }

          currencyCode
          sourceName
          displayFulfillmentStatus
          displayFinancialStatus

          lineItems(first: 20) {
            edges {
              node {
                id
                quantity
                sku
                product {
                  id
                }
                variant {
                  id
                  sku
                }
                originalUnitPriceSet {
                  shopMoney { amount }
                }
                discountedUnitPriceSet {
                  shopMoney { amount }
                }
                originalTotalSet {
                  shopMoney { amount }
                }
              }
            }
          }
        }
      }
    }

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

    /* if (data?.orders?.edges?.length > 0) {
      console.log(
        '[DEBUG] Sample Shopify order node:',
        JSON.stringify(data.orders.edges[0].node, null, 2)
      );
    } */

    console.log(`[ShopifyService] GraphQL response received, data keys:`, Object.keys(data));

    const totalProducts = data.products?.edges.length || 0;
    const totalOrders = data.orders?.edges.length || 0;

    const totalLineItems = (data.orders?.edges || []).reduce((acc: number, { node }: any) => {
      return acc + (node.lineItems?.edges.length || 0);
    }, 0);

    const totalProgress = totalProducts + totalOrders + totalLineItems;
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

        /**
         * Canonical Variant Backfill Trigger
         * ----------------------------------
         * Purpose:
         * - Replay all products through product_ingestion
         * - Required when canonical_variants is introduced after initial sync
         *
         * Safety:
         * - Idempotent
         * - No writes outside product-worker
         * - Safe to re-run
         */
        for (const { node } of data.products.edges) {
          enqueueProductForIngestion({
            shopId,
            platform: 'shopify',
            rawProduct: node,
          });
        }

        // --- 2. Report: SYNCING_ORDERS ---
        await trx('integrations').where({ id: integrationId }).update({
          sync_status: 'SYNCING_ORDERS',
          sync_progress_current: totalProducts,
        });
      }

      if (data.orders) {
        console.log(`[ShopifyService] Syncing ${data.orders.edges.length} orders...`);
        await syncOrders(trx, shopId, data.orders.edges);

        /**
         * FT2 Canonical Order Contract
         * ----------------------------
         * FT2 requires order-level monetary completeness only.
         * Line-item economics are optional and may be enriched later.
         *
         * DO NOT add line-item pricing requirements here.
         */
        const canonicalIngestion = new CanonicalCommerceIngestionService();

        for (const { node } of data.orders.edges) {
          const canonicalOrder =
            mapShopifyOrderNodeToCanonical(node, shopId);

          /**
           * Canonical Order Eligibility (FT2)
           * --------------------------------
           * FT2 requires order-level monetary completeness only.
           * Line-item economics are optional at this stage.
           */
          if (
            !canonicalOrder.createdAt ||
            !canonicalOrder.currency ||
            canonicalOrder.totalPrice == null ||
            canonicalOrder.subtotalPrice == null ||
            canonicalOrder.totalTax == null
          ) {
            console.warn('[CANONICAL_SKIP_ORDER]', {
              shopId,
              platformOrderId: canonicalOrder.platformOrderId,
              reason: 'INCOMPLETE_ORDER_TOTALS'
            });
            continue;
          }

          /**
           * CANONICAL LINE ITEM PRODUCT HARD GATE (FT2)
           * ------------------------------------------
           * insertCanonicalOrder REQUIRES:
           * - lineItem.productId !== null
           *
           * Variant presence alone is insufficient.
           */
          const hasMissingProduct = canonicalOrder.lineItems.some(
            li => li.productId == null
          );

          if (hasMissingProduct) {
            await recordIncompleteOrder({
              shopId,
              platform: 'shopify',
              platformOrderId: canonicalOrder.platformOrderId,
              reason: 'LINE_ITEM_PRODUCT_NOT_RESOLVED',
            });
            continue;
          }


          // --- CANONICAL VARIANT HARD GATE (FT2) ---
          const variantIds = canonicalOrder.lineItems
            .map(li => li.variantId)
            .filter((v): v is string => typeof v === 'string');

          if (variantIds.length === 0) {
            await recordIncompleteOrder({
              shopId,
              platform: 'shopify',
              platformOrderId: canonicalOrder.platformOrderId,
              reason: 'NO_VARIANTS_ON_ORDER',
            });
            continue;
          }

          /**
           * CANONICAL VARIANT HARD GATE (FT2)
           * --------------------------------
           * Purpose:
           * - Enforce variant → product anchoring BEFORE canonical order insertion
           *
           * Facts:
           * - canonical_variants is keyed by (shop_id, canonical_variant_id)
           * - platform_variant_id does NOT exist in canonical storage
           *
           * Rule:
           * - If ANY referenced canonical_variant_id lacks canonical_product_id,
           *   the order MUST be deferred (not partially ingested).
           *
           * This gate prevents:
           * - orphaned canonical_order_line_items
           * - FT2 identity violations
           * - false-positive revenue / order counts
           */
          const unresolved = await db('canonical_variants')
            .where({ shop_id: shopId })
            .whereIn('canonical_variant_id', variantIds)
            .whereNull('canonical_product_id')
            .count<{ count: string }>('id as count')
            .first();

          if (unresolved && Number(unresolved.count) > 0) {
            await recordIncompleteOrder({
              shopId,
              platform: 'shopify',
              platformOrderId: canonicalOrder.platformOrderId,
              reason: 'CANONICAL_VARIANT_NOT_READY',
            });

            // ⛔ Do NOT insert canonical order yet
            // Product worker must finish first
            continue;
          }

          await canonicalIngestion.insertCanonicalOrder(canonicalOrder);

          if (node.displayFulfillmentStatus === 'FULFILLED') {
            publishReconciliationJob(canonicalOrder.id, {
              status: 'delivered',
              observedAt: new Date(
                node.updatedAt ?? node.processedAt ?? node.createdAt
              ),
              source: 'shopify_sync',
            });
          } else {
            publishReconciliationJob(canonicalOrder.id);
          }
        }

        await trx('integrations').where({ id: integrationId }).update({
          sync_status: 'SYNCING_LINE_ITEMS',
          sync_progress_current: totalProducts + totalOrders,
        });
        console.log(`[ShopifyService] Syncing ${totalLineItems} line items...`);
        await syncOrderLineItems(trx, shopId, data.orders.edges);
        // --- END OF BLOCK ---

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
  const ordersToInsert = edges.map(({ node }: any) => {
    // Under PCD without approval, we cannot access any customer or address data
    // We can only use the order data itself
    
    return {
      shop_id: shopId,
      platform_order_id: node.id,
      order_number: node.name,
      fulfillment_status: node.displayFulfillmentStatus?.toLowerCase() || 'pending',
      financial_status: node.displayFinancialStatus?.toLowerCase() || 'pending',
      total_price: parseFloat(node.totalPriceSet?.shopMoney?.amount || '0'),
      currency: node.currencyCode,
      created_at: node.createdAt,
      source_name: node.sourceName,
      // No customer data available under PCD without approval
      customer_name: `Customer #${node.name}`,
      customer_email: '', 
      customer_phone: '',
      platform_customer_id: null,
      shipping_address: null, // No address data available
    };
  });

  if (ordersToInsert.length > 0) {
    await trx('orders')
      .insert(ordersToInsert)
      .onConflict('platform_order_id')
      .merge();
    console.log(`[ShopifyService] Synced ${ordersToInsert.length} orders with minimal PCD-compliant data.`);
  }
}

async function syncOrderLineItems(
  trx: Knex.Transaction,
  shopId: number,
  orderEdges: any[],
) {
  const lineItemsToInsert: any[] = [];

  // Iterate over each order
  for (const { node: order } of orderEdges) {
    const orderId = order.id;
    const lineItemEdges = order.lineItems?.edges || [];

    // Iterate over each line item in that order
    for (const { node: lineItem } of lineItemEdges) {
      lineItemsToInsert.push({
        shop_id: shopId,
        platform_order_id: orderId,
        platform_line_item_id: lineItem.id,
        platform_product_id: lineItem.product?.id,
        quantity: lineItem.quantity,
        // We'll get price later if needed; for now, we just need product/quantity
      });
    }
  }

  if (lineItemsToInsert.length > 0) {
    await trx('order_line_items')
      .insert(lineItemsToInsert)
      .onConflict(['shop_id', 'platform_line_item_id']) // Assumes this conflict target
      .merge();
    console.log(
      `[ShopifyService] Synced ${lineItemsToInsert.length} line items.`,
    );
  }
}

async function syncOrdersAndFulfillments(trx: Knex.Transaction, shopId: number, edges: any[]) {
  const ordersToInsert: any[] = [];
  const fulfillmentsToInsert: any[] = []; 

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