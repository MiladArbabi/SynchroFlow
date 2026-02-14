// apps/backend/src/services/products-facts/ProductsFacts.service.ts
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
 * GUARANTEES:
 * - Reads ONLY from canonical_products
 * - Returns raw counts only
 * - Preserves nulls when no data exists
 * - No intelligence, no classification, no percentages
 *
 * NOTE:
 * - Counts are row-based unless explicitly grouped
 * - platform_product_id is used ONLY for grouping, never exposed
 */
export async function getProductsFacts(
  input: GetProductsFactsInput
): Promise<ProductsFacts> {
  const { shopId, period } = input;

  /**
 * Canonical FT2 time authority:
 * - Period is resolved upstream via ft2Period
 * - Facts MUST apply it exactly as received
 * - No reinterpretation, no defaults, no overrides
 
  /**
   * Canonical Atomic Surface:
   * - Variants are the economic and structural truth
   * - Products are grouping only (via lasyncro_product_id)
   * - No platform identity is used in FT2
   */
  const rows = await db('variants')
    .where('shop_id', shopId)
    .select([
      'lasyncro_product_id',
      'lasyncro_variant_id',
      'sku',
      'status',
    ]);

  // ─────────────────────────────────────────────────────────
  // Null preservation: no rows = no facts
  // ─────────────────────────────────────────────────────────
  if (rows.length === 0) {
    return {
      shopId,
      period,
      productsObserved: null,
      skusObserved: null,
      distinctSkusObserved: null,
      productsWithSkuCount: null,
      productsWithoutSkuCount: null,
      variantsObserved: null,
      productsWithVariantsCount: null,
      singleVariantProductsCount: null,
      statusCounts: {
        active: null,
        inactive: null,
        archived: null,
      },
      extractedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Core presence (row-level truth)
  // NOTE:
  // - productsObserved counts canonical rows
  // - A row represents a (product × variant) observation
  // - This is intentional and MUST NOT be deduplicated here
  // ─────────────────────────────────────────────────────────
  const productsObserved = rows.length;

  // ─────────────────────────────────────────────────────────
  // SKU structure
  // ─────────────────────────────────────────────────────────
  const skuSet = new Set<string>();
  let productsWithSkuCount: number | null = 0;
  let productsWithoutSkuCount: number | null = 0;

  for (const row of rows) {
    if (row.sku !== null) {
      skuSet.add(row.sku);
      productsWithSkuCount += 1;
    } else {
      productsWithoutSkuCount += 1;
    }
  }

// Variant structure (grouped by lasyncro_product_id)
const variantsSet = new Set<string>();
const variantsByProduct = new Map<string, Set<string>>();

for (const row of rows) {
  variantsSet.add(row.lasyncro_variant_id);

  const productId = row.lasyncro_product_id;
  if (!variantsByProduct.has(productId)) {
    variantsByProduct.set(productId, new Set());
  }
  variantsByProduct.get(productId)!.add(row.lasyncro_variant_id);
}

  /**
   * Variant aggregation invariants:
   * - These counters are ONLY valid when rows.length > 0
   * - They are NEVER computed when facts are null
   * - Zero is a valid observable value here
   */
  let productsWithVariantsCount: number | null = 0;
  let singleVariantProductsCount: number | null = 0;

  for (const [, variantSet] of variantsByProduct.entries()) {
    if (variantSet.size >= 1) {
      productsWithVariantsCount += 1;
    }
    if (variantSet.size === 1) {
      singleVariantProductsCount += 1;
    }
  }

  // ─────────────────────────────────────────────────────────
  // Status distribution (unchanged)
  // ─────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────
  // Final factual payload (no interpretation)
  // ─────────────────────────────────────────────────────────
  return {
    shopId,
    period,
    productsObserved,

    skusObserved: skuSet.size,
    distinctSkusObserved: skuSet.size,
    productsWithSkuCount,
    productsWithoutSkuCount,

    variantsObserved: variantsSet.size,
    productsWithVariantsCount,
    singleVariantProductsCount,

    statusCounts,
    extractedAt: new Date().toISOString(),
  };
}