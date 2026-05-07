import { Knex } from 'knex';
import { syncProducts } from './shopifyProducts.core.js';

/**
 * SHOPIFY PRODUCT SYNC SERVICE
 * ----------------------------
 * Isolates product ingestion logic from orchestration.
 *
 * Guarantees:
 * - separation of concerns
 * - independent evolution of product domain
 * - reduced orchestration complexity
 */

export const syncShopifyProducts = async ({
  trx,
  shopId,
  integrationId,
  accessToken,
  platformShopName,
  products,
}: {
  trx: Knex.Transaction;
  shopId: number;
  integrationId: number;
  accessToken: string;
  platformShopName: string;
  products: any[];
}) => {
  console.info('[SHOPIFY_PRODUCT_SYNC_START]', {
    shopId,
    count: products.length,
  });

  // Existing logic preserved
  await syncProducts(trx, shopId, products);

  console.info('[SHOPIFY_PRODUCT_SYNC_COMPLETED]', {
    shopId,
  });
};