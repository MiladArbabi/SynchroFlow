// apps/backend/src/services/shopify.service.ts
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

import { Knex } from 'knex';
import crypto from 'crypto';
import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../queue.js';
import { seedShopifyOpeningBalances } from './inventory/seedShopifyOpeningBalances.js';
import { enqueueProductForIngestion } from './product-ingestion.service.js';
import OrderFulfillmentIngestionService from './order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';
import { resolveExternalOrderId } from './identity/resolveExternalOrder.service.js';

type DbExecutor = Knex | Knex.Transaction;

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
  'read_returns',
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
                price
                compareAtPrice
                createdAt
                updatedAt
                inventoryItem {
                  id
                }
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

    const stagedEventIds: number[] = [];
    let sovereignOrderIds: string[] = [];

    // 4. Use a transaction to sync all data or none
    await db.transaction(async (trx) => {
      if (data.products) {
        console.log(`[ShopifyService] Syncing ${data.products.edges.length} products...`);

        await syncProducts(trx, shopId, data.products.edges);

        await seedShopifyOpeningBalances(
          trx,
          accessToken,
          platformShopName,
          shopId
        );

        /**
         * PRODUCT INGESTION QUEUE (LEGACY DRAIN)
         * --------------------------------------
         * The canonical product layer has been removed.
         *
         * Product identity now lives in:
         *   - products (sovereign table)
         *   - order_line_items (sovereign FK)
         *
         * The product_ingestion queue remains only for
         * backward compatibility and safe draining.
         *
         * This enqueue is safe but no longer performs
         * canonical persistence.
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

      /**
       * ORDER STAGING — CANONICAL INGESTION ENTRY POINT
       * ----------------------------------------------
       * Orders MUST be staged before canonical ingestion.
       *
       * Guarantees:
       * - Durable fact preservation
       * - Replayability via staged_events
       * - Explicit execution proof for FT2
       *
       * No inference. No defaults. No execution.
       */
      if (data.orders?.edges?.length) {
        for (const { node } of data.orders.edges) {
          const [staged] = await trx('staged_events')
            .insert({
              source_platform: 'shopify',
              event_type: 'orders/sync',
              raw_payload: node,
              shop_id: shopId,
            })
            .returning<{ id: number }[]>('id');

          stagedEventIds.push(staged.id);
        }
      
      /**
       * SOVEREIGN MATERIALIZATION
       * -------------------------
       * Orders MUST exist in `orders` table for:
       *   - FT2 evaluator
       *   - cross-domain checks
       *   - revenue units
       *
       * Staging alone is insufficient.
       */
      sovereignOrderIds = await syncOrders(
        trx,
        shopId,
        data.orders.edges
      );

      await syncOrderLineItems(
        trx,
        shopId,
        data.orders.edges
      );

      /**
       * Fulfillment Snapshot Hydration
       * ------------------------------
       * Establish baseline execution truth for all synced orders.
       *
       * Must execute AFTER:
       *   - orders are inserted
       *   - line items are materialized
       *
       * Still inside the same DB transaction to guarantee atomic onboarding.
       */
      await hydrateFulfillmentSnapshot(
        trx,
        shopId,
        data.orders.edges
      );


      /**
       * RECONCILIATION INTENT DISABLED (SYNC PATH)
       * -------------------------------------------
       * Orders are no longer materialized via GraphQL sync.
       * Canonical order creation occurs exclusively through webhook ingestion.
       *
       * Therefore reconciliation intents must NOT be created here.
       */
      }
    });

    /**
     * RECONCILIATION DISPATCH DISABLED (SYNC PATH)
     * --------------------------------------------
     * Reconciliation is triggered only by canonical
     * webhook ingestion boundary.
     */

    const channel = getQueueChannel('events');

    for (const staged_event_id of stagedEventIds) {
      channel.sendToQueue(
        'events',
        Buffer.from(JSON.stringify({ staged_event_id })),
      );
    }

    // Products are now committed.
    // Product ingestion writes directly to sovereign products table.
    // No canonical layer exists.

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

async function syncProducts(
  trx: DbExecutor,
  shopId: number,
  edges: any[]
) {
  for (const { node } of edges) {
    const productId = crypto.randomUUID();

    // 1. Insert product container
    await trx('products')
      .insert({
        lasyncro_product_id: productId,
        shop_id: shopId,
        title: node.title,
        status: node.status?.toLowerCase() || 'active',
      })
      .onConflict('lasyncro_product_id')
      .ignore();

    const variantEdges = node.variants?.edges || [];

    for (const { node: variant } of variantEdges) {
      const variantId = crypto.randomUUID();

      // 2. Insert variant (atomic unit)
      await trx('variants')
        .insert({
          lasyncro_variant_id: variantId,
          lasyncro_product_id: productId,
          shop_id: shopId,
          sku: variant.sku || null,
          title: variant.title,
          status: 'active',
        })
        .onConflict('lasyncro_variant_id')
        .ignore();

      // 3. Insert external identity mapping (variant-level)
      await trx('external_product_identity_map')
        .insert({
          id: crypto.randomUUID(),
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          platform: 'shopify',
          external_product_id: node.id,
          external_variant_id: variant.id,
          external_inventory_item_id: variant.inventoryItem?.id || null,
          external_sku: variant.sku || null,
        })
        .onConflict([
          'shop_id',
          'platform',
          'external_product_id',
          'external_variant_id',
        ])
        .ignore();
    }
  }

  console.log(`[ShopifyService] Synced ${edges.length} products (variant-atomic).`);
}

// Sovereign Orders Materialization (Schema-Aligned)
async function syncOrders(
  trx: DbExecutor,
  shopId: number,
  edges: any[]
): Promise<string[]> {
  const ordersToInsert = edges.map(({ node }: any) => ({
    lasyncro_order_id: crypto.randomUUID(), // internal UUID
    shop_id: shopId,

    payment_state:
      node.displayFinancialStatus?.toLowerCase() || 'unknown',

    currency: node.currencyCode,

    total_price: parseFloat(
      node.totalPriceSet?.shopMoney?.amount || '0'
    ),

    subtotal_price: parseFloat(
      node.subtotalPriceSet?.shopMoney?.amount || '0'
    ),

    total_tax: parseFloat(
      node.totalTaxSet?.shopMoney?.amount || '0'
    ),

    source: node.sourceName || null,
    referrer_medium: null,

    customer_hashed_id: null, // PCD restricted

    order_created_at: node.createdAt,
    order_updated_at: node.updatedAt,
    order_processed_at: node.processedAt || null,
  }));

  if (ordersToInsert.length > 0) {
    /**
     * ORDER MATERIALIZATION DISABLED
     * --------------------------------
     * Sovereign orders must originate exclusively
     * from canonical webhook ingestion boundary.
     *
     * GraphQL syncOrders is no longer authorized
     * to materialize sovereign order rows.
     */
    
    /**
     * ORDER IDENTITY WRITE DISABLED
     * ------------------------------
     * Canonical external identity enforcement occurs
     * exclusively at webhook ingestion boundary (worker).
     *
     * GraphQL sync must NOT write to:
     * - external_order_identity_map
     *
     * Reason:
     * Prevent GID format drift and dual ingestion writers.
     */
    console.log(
      `[ShopifyService] Synced ${ordersToInsert.length} orders (schema-aligned).`
    );

    return ordersToInsert.map(o => o.lasyncro_order_id);
  }
  return [];
}

async function syncOrderLineItems(
  trx: DbExecutor,
  shopId: number,
  orderEdges: any[],
) {
  const rows: any[] = [];

  for (const { node: order } of orderEdges) {
    const platformOrderId = order.id;

    // Resolve sovereign order ID
    const lasyncroOrderId = await resolveExternalOrderId(
      shopId,
      'shopify',
      platformOrderId
    );

    if (!lasyncroOrderId) continue;

    const sovereignOrder = {
      lasyncro_order_id: lasyncroOrderId,
    };

    if (!sovereignOrder) continue;

    for (const { node: lineItem } of order.lineItems?.edges || []) {
      const platformVariantId = lineItem.variant?.id;
        if (!platformVariantId) continue;

        // Resolve sovereign variant directly
        const sovereignVariant = await trx('external_product_identity_map')
          .select('lasyncro_variant_id')
          .where({
            shop_id: shopId,
            platform: 'shopify',
            external_variant_id: platformVariantId,
          })
          .first();

        if (!sovereignVariant) continue;

        // Resolve parent product from variant
        const variantRow = await trx('variants')
          .select('lasyncro_product_id')
          .where({
            lasyncro_variant_id: sovereignVariant.lasyncro_variant_id,
          })
          .first();

        if (!variantRow) continue;

      const quantity = lineItem.quantity || 0;
      const unitPrice = parseFloat(
        lineItem.originalUnitPriceSet?.shopMoney?.amount || '0'
      );
      const lineTotal = unitPrice * quantity;

      rows.push({
        lasyncro_line_item_id: crypto.randomUUID(),
        lasyncro_order_id: sovereignOrder.lasyncro_order_id,
        lasyncro_product_id: variantRow.lasyncro_product_id,
        lasyncro_variant_id: sovereignVariant.lasyncro_variant_id,
        title: lineItem.title || 'Untitled',
        sku: lineItem.sku || null,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        platform: 'shopify',
        external_line_item_id: lineItem.id,
      });
    }
  }

  if (rows.length > 0) {
    await trx('order_line_items')
      .insert(rows)
      .onConflict(['platform', 'external_line_item_id'])
      .ignore();

    console.log(
      `[ShopifyService] Synced ${rows.length} line items (schema-aligned).`,
    );
  }
};

/**
 * Fulfillment Snapshot Hydrator
 * -----------------------------
 * Purpose:
 *   Reconstruct authoritative fulfillment state during initial sync.
 *
 * Invariants:
 *   - NEVER writes directly to order_fulfillment_status.
 *   - Uses OrderFulfillmentIngestionService as the ONLY write boundary.
 *   - Fully idempotent (relies on ingestion upsert logic).
 *   - Represents terminal snapshot state only (no transition states).
 *
 * Execution Semantics:
 *   Snapshot establishes baseline truth.
 *   Webhooks apply future deltas.
 */
async function hydrateFulfillmentSnapshot(
  trx: DbExecutor,
  shopId: number,
  orderEdges: any[]
): Promise<void> {

  /**
   * Deterministic mapping:
   * Shopify → Sovereign execution state
   *
   * NOTE:
   * - Snapshot must not emit "processing".
   * - Snapshot reflects terminal observable state only.
   */
  function mapSnapshotStatus(
    displayStatus: string | null | undefined
  ): 'pending' | 'fulfilled' | 'partially_fulfilled' | 'cancelled' {

    switch (displayStatus) {
      case 'FULFILLED':
        return 'fulfilled';

      case 'PARTIALLY_FULFILLED':
        return 'partially_fulfilled';

      case 'RESTOCKED':
        return 'cancelled';

      case 'UNFULFILLED':
      default:
        return 'pending';
    }
  }

  for (const { node } of orderEdges) {
    const platformOrderId = node.id;

    console.log('[HYDRATE]', platformOrderId, node.displayFulfillmentStatus);

    // Resolve sovereign order identity (UUID anchor)
    const lasyncroOrderId = await resolveExternalOrderId(
      shopId,
      'shopify',
      platformOrderId
    );

    if (!lasyncroOrderId) continue;

    const sovereignOrder = {
      lasyncro_order_id: lasyncroOrderId,
    };

    if (!sovereignOrder) continue;

    const mappedStatus = mapSnapshotStatus(
      node.displayFulfillmentStatus
    );

    // Authoritative ingestion boundary
    await OrderFulfillmentIngestionService.ingestStatus(
      {
        lasyncroOrderId: sovereignOrder.lasyncro_order_id,
        status: mappedStatus,
      },
      trx
    );
  }
}