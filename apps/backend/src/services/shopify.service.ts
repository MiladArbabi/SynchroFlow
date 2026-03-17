// apps/backend/src/services/shopify.service.ts
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

import { Knex } from 'knex';
import crypto from 'crypto';
import db from '@lasyncro/backend-core/db.js';
import { seedShopifyOpeningBalances } from './inventory/seedShopifyOpeningBalances.js';
import { enqueueProductForIngestion } from './product-ingestion.service.js';
import { resolveExternalOrderId } from './identity/resolveExternalOrder.service.js';
import OrderFulfillmentIngestionService from './order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';

/**
 * HISTORICAL SNAPSHOT BACKFILL
 * ----------------------------
 * Generates operational timeline immediately after
 * initial Shopify ingestion completes.
 */
import { backfillShopOperationalSnapshots } from '../workers/projections/shopOperationalSnapshot.backfill.js';
import { backfillFulfillmentEvent } from './fulfillment/fulfillmentBackfill.service.js';


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
                  unitCost {
                    amount
                  }
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

const ordersQuery = `
  query getOrders($cursor: String) {
    orders(
      first: 50
      after: $cursor
      sortKey: CREATED_AT
    ) {
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
                product { id }
                variant { id sku }

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

      pageInfo {
        hasNextPage
        endCursor
      }
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

    /* console.log(`[ShopifyService] GraphQL response received, data keys:`, Object.keys(data)); */

    const totalProducts = data.products?.edges.length || 0;
    const totalOrders = 0;
    const totalLineItems = 0;

    const totalProgress = totalProducts + totalOrders + totalLineItems;
    // --- 1. Report: STARTING (Products) ---
    await db('integrations').where({ id: integrationId }).update({
      sync_status: 'SYNCING_PRODUCTS',
      sync_last_error: null,
      sync_progress_current: 0,
      sync_progress_total: totalProgress,
    });

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
       * ORDER PAGINATION LOOP
       * ---------------------
       * Shopify GraphQL returns orders in pages.
       * The initial query fetches only the first 50.
       *
       * This loop ensures full historical ingestion.
       */
      let ordersCursor: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {

        const response = await client.request(ordersQuery, {
          variables: { cursor: ordersCursor }
        });

        const page = response.data as any;

        console.log(
          '[SHOPIFY_PAGINATION]',
          page.orders.pageInfo.hasNextPage,
          page.orders.pageInfo.endCursor
        );
        
        const orderEdges = page.orders.edges;

        if (orderEdges?.length) {
          for (const { node } of orderEdges) {

            let domainEventId: number | null = null;

            try {
              const [inserted] = await trx('domain_events')
                .insert({
                  shop_id: shopId,
                  event_type: 'orders/sync',
                  event_payload: node,
                  event_time: new Date(node.createdAt),
                  event_version: 1,
                  external_event_id: String(node.id),
                })
                .returning<{ id: number }[]>('id');

              domainEventId = inserted.id;

            } catch (err: any) {
              if (err?.code === '23505') {
                console.warn('[SYNC_DUPLICATE_DOMAIN_EVENT]', {
                  shopId,
                  externalEventId: node.id,
                });
                continue;
              }

              throw err;
            }
          }

        /**
         * PAGINATION ADVANCE
         * ------------------
         * Must execute regardless of edge count
         * to prevent infinite loops.
         */
        hasNextPage = page.orders.pageInfo.hasNextPage;
        ordersCursor = page.orders.pageInfo.endCursor;
    }
      
      /**
       * ❗ ORDER MATERIALIZATION REMOVED
       * --------------------------------
       * Orders are staged only.
       * Canonical materialization occurs exclusively
       * via staged_events → worker boundary.
       */

      /**
       * ❗ LINE ITEM SNAPSHOT REMOVED
       * -----------------------------
       * Line items must materialize only after
       * canonical order creation inside worker.
       *
       * Snapshot sync must not depend on identity
       * that does not yet exist.
       */

      /**
       * ❗ FULFILLMENT HYDRATION REMOVED
       * --------------------------------
       * Execution state must enter system exclusively
       * via staged_events → worker canonical boundary.
       *
       * GraphQL snapshot sync MUST NOT mutate
       * order_fulfillment_status directly.
       *
       * Fulfillment state will be established
       * only via webhook ingestion.
       */

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

    // Products are now committed.
    // Product ingestion writes directly to sovereign products table.
    // No canonical layer exists.

    // --- 4. Report: COMPLETED ---
    await db('integrations').where({ id: integrationId }).update({
      sync_status: 'COMPLETED',
      sync_last_error: null,
    });

    console.log(`[ShopifyService] Sync COMPLETED for shopId: ${shopId}`);

    /**
     * RESOLVE SHOP DOMAIN FOR WEBHOOK REGISTRATION
     * --------------------------------------------
     * Required because shopDomain is not in scope here.
     */
    const installationRow = await db('shopify_app_installations')
      .where({ shop_id: shopId })
      .select('shop_domain', 'access_token')
      .first();

    if (!installationRow?.shop_domain || !installationRow?.access_token) {
      throw new Error('[WEBHOOK_REGISTRATION_FAILED] Missing shop domain or token');
    }

    try {
      await registerShopifyWebhooks(
        installationRow.shop_domain,
        installationRow.access_token
      );
    } catch (err) {
      console.error('[WEBHOOK_REGISTRATION_FAILED_NON_FATAL]', {
        shopId,
        error: (err as Error).message,
      });
    }
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

      /**
       * CATALOG COST EXTRACTION
       * -----------------------
       * Shopify frequently omits variant cost.
       *
       * Ingestion must never fail because of missing cost.
       * Instead we record the variant with a placeholder
       * cost and allow the economics pipeline to detect
       * missing cost during reconciliation.
       * TODO: Capture the products with missing costs and prompt user
       * to fill in the missing costs!
       */
      const unitCostAmount = variant.inventoryItem?.unitCost?.amount;

      let unitCost = 0;

      if (!unitCostAmount) {
        console.warn(
          `[SHOPIFY_COST_MISSING] Variant ${variant.id} has no inventory cost`
        );
      } else {
        unitCost = Number(unitCostAmount);
      }
      const variantId = crypto.randomUUID();

      // 2. Insert variant (atomic unit)
      await trx('variants')
        .insert({
          lasyncro_variant_id: variantId,
          lasyncro_product_id: productId,
          shop_id: shopId,
          sku: variant.sku || null,
          title: variant.title,
          unit_cost: unitCost,
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

/**
 * @deprecated
 * Snapshot-based order materialization removed.
 *
 * Orders must originate exclusively
 * from staged_events → worker boundary.
 */

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

/**
 * @deprecated
 * Snapshot-based line item materialization removed.
 *
 * Line items are created exclusively
 * during worker canonical ingestion.
 */

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
 * @deprecated
 * Removed due to canonical boundary violation.
 *
 * Execution state must flow exclusively
 * through staged_events → worker.
 *
 * This function must not be invoked.
 */

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
    trx: Knex.Transaction,
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
    const platformOrderGid = node.id;

    console.log('[HYDRATE RAW]', {
      gid: platformOrderGid,
      displayFulfillmentStatus: node.displayFulfillmentStatus,
      typeof: typeof node.displayFulfillmentStatus
    });

    /**
     * Normalize Shopify GID → numeric external_order_id
     *
     * Shopify GraphQL returns:
     *   gid://shopify/Order/16567328080242
     *
     * Identity map stores:
     *   16567328080242
     *
     * Hydration MUST strip the GID prefix before resolution.
     */
    const platformOrderId = platformOrderGid.split('/').pop() ?? null;

    if (!platformOrderId) continue;

    // Resolve sovereign order identity (UUID anchor)
    const lasyncroOrderId = await resolveExternalOrderId(
      shopId,
      'shopify',
      platformOrderId,
      trx
    );

    console.log('[RESOLVE]', {
      platformOrderId,
      lasyncroOrderId
    });

    if (!lasyncroOrderId) continue;

    const sovereignOrder = {
      lasyncro_order_id: lasyncroOrderId,
    };

    if (!sovereignOrder) continue;
  }
}

/**
 * REGISTER REQUIRED SHOPIFY WEBHOOKS
 * ----------------------------------
 * Ensures system receives execution events.
 */
async function registerShopifyWebhooks(
  shopDomain: string,
  accessToken: string
) {
  const topics = [
    'fulfillments/create',
    'fulfillments/update',
  ];

  for (const topic of topics) {
    await fetch(`https://${shopDomain}/admin/api/2024-01/webhooks.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhook: {
          topic,
          address: `${process.env.APP_BASE_URL}/api/shopify/webhook`,
          format: 'json',
        },
      }),
    });

    console.info('[SHOPIFY_WEBHOOK_REGISTERED]', { topic });
  }
}