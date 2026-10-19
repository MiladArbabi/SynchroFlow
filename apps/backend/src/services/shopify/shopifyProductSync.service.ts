import { Knex } from 'knex';
import { syncProducts } from './shopifyProducts.core.js';
import { catalogFreshnessBaselineOf } from './shopifyCatalogPagination.service.js';

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

  // GH-1262 A2.2 C4a: a complete catalog collection carries its pre-fetch
  // freshness baseline; any other input keeps the untrusted-input rules.
  await syncProducts(trx, shopId, products, {
    freshnessBaseline: catalogFreshnessBaselineOf(products),
  });

  console.info('[SHOPIFY_PRODUCT_SYNC_COMPLETED]', {
    shopId,
  });
};