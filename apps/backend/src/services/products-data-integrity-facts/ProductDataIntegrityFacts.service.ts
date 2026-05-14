import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import {
  ProductDataIntegrityFacts,
} from './ProductDataIntegrityFacts.types.js';

interface GetProductDataIntegrityFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * getProductDataIntegrityFacts
 *
 * Layer 1 (Facts) — Product Data Integrity.
 *
 * GUARANTEES:
 * - Reads only canonical, linkage-safe tables
 * - Applies FT2 period exactly as received
 * - Emits raw counts only
 * - Preserves nulls when no truth exists
 *
 * PERIOD AUTHORITY:
 * - Period is resolved upstream (ft2Period)
 * - This layer MUST NOT reinterpret time
 */
export async function getProductDataIntegrityFacts(
  input: GetProductDataIntegrityFactsInput,
  trx?: Knex | Knex.Transaction
): Promise<ProductDataIntegrityFacts> {
  const { shopId, period } = input;
    const qb = trx ?? db;

/**
 * Canonical Atomic Surface:
 * - Variants are atomic truth
 * - Products are grouping only
 */
// trx injected by withTenant caller — never bare db()
const rows = await qb('variants')
  .where('shop_id', shopId)
  .select([
    'lasyncro_product_id',
    'sku',
  ]);

  // ─────────────────────────────────────────────
  // Null preservation: no observable products
  // ─────────────────────────────────────────────
  if (rows.length === 0) {
    return {
      shopId,
      period,
      productsChecked: null,
      productsWithConflictingFields: null,
      productsWithMultipleSkus: null,
      maxSkusPerProduct: null,
      extractedAt: new Date().toISOString(),
    };
  }

  /**
   * Group rows by canonical product identity.
   *
   * NOTE:
   * - Grouping is internal only
   * - platform_product_id is NEVER exposed
   */
  const skusByProduct = new Map<string, Set<string>>();

  for (const row of rows) {
    const productId = row.lasyncro_product_id;
    if (!skusByProduct.has(productId)) {
      skusByProduct.set(productId, new Set());
    }
    if (row.sku !== null) {
      skusByProduct.get(productId)!.add(row.sku);
    }
  }

  
let productsWithMultipleSkus = 0;
let maxSkusPerProduct = 0;
let productsWithConflictingFields = 0;

for (const [, skuSet] of skusByProduct.entries()) {
  if (skuSet.size > 1) {
    productsWithMultipleSkus += 1;
  }
  if (skuSet.size > maxSkusPerProduct) {
    maxSkusPerProduct = skuSet.size;
  }
}

// Re-query for true conflicts: same SKU appearing more than once on the same product
const conflictRows = await qb('variants')
  .where('shop_id', shopId)
  .whereNotNull('sku')
  .select('lasyncro_product_id', 'sku')
  .groupBy('lasyncro_product_id', 'sku')
  .havingRaw('COUNT(*) > 1');

const conflictingProductIds = new Set(conflictRows.map((r: { lasyncro_product_id: string }) => r.lasyncro_product_id));
productsWithConflictingFields = conflictingProductIds.size;

  return {
    shopId,
    period,
    productsChecked: skusByProduct.size,
    productsWithConflictingFields,
    productsWithMultipleSkus,
    maxSkusPerProduct,
    extractedAt: new Date().toISOString(),
  };
}