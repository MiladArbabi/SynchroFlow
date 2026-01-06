//apps/backend/src/services/products-facts/ProductsFacts.service.ts
import db from 'api-db';
import { ProductsFacts } from './ProductsFacts.types';

interface GetProductsFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * getProductsFacts
 *
 * Layer 1 (Facts) implementation for Products / SKU-OS.
 *
 * Guarantees:
 * - Reads ONLY from canonical_products
 * - Returns raw counts only
 * - Preserves nulls when no data exists
 * - No intelligence, no classification, no percentages
 */
export async function getProductsFacts(
  input: GetProductsFactsInput
): Promise<ProductsFacts> {
  const { shopId, period } = input;

  const rows = await db('canonical_products')
    .where('shop_id', shopId)
    .andWhere('created_at', '>=', period.from)
    .andWhere('created_at', '<=', period.to)
    .select(['sku', 'status']);

  // No rows → preserve nulls everywhere
  if (rows.length === 0) {
    return {
      shopId,
      period,
      productsObserved: null,
      skusObserved: null,
      statusCounts: {
        active: null,
        inactive: null,
        archived: null,
      },
      extractedAt: new Date().toISOString(),
    };
  }

  // Raw counts only — no interpretation
  const productsObserved = rows.length;

  const skuSet = new Set<string>();
  for (const row of rows) {
    if (row.sku !== null) {
      skuSet.add(row.sku);
    }
  }

  const statusCounts = {
    active: 0,
    inactive: 0,
    archived: 0,
  };

  for (const row of rows) {
    if (row.status === 'active') statusCounts.active += 1;
    if (row.status === 'inactive') statusCounts.inactive += 1;
    if (row.status === 'archived') statusCounts.archived += 1;
  }

  return {
    shopId,
    period,
    productsObserved,
    skusObserved: skuSet.size,
    statusCounts,
    extractedAt: new Date().toISOString(),
  };
}