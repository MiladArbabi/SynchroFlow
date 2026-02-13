import db from 'api-db';
import { ProductOperationalFacts } from './ProductOperationalFacts.types';

interface GetProductOperationalFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * getProductOperationalFacts
 *
 * Layer 1 (Facts) for Product Operational Exposure.
 *
 * GUARANTEES:
 * - Reads only from existing operational tables
 * - No inference, no joins implying correctness
 * - Period applied ONLY to historical_sales
 * - Snapshot tables are not time-filtered
 */
export async function getProductOperationalFacts(
  input: GetProductOperationalFactsInput
): Promise<ProductOperationalFacts> {
  const { shopId, period } = input;

  // ─────────────────────────────────────────
  // Canonical products (snapshot, no period)
  // ─────────────────────────────────────────
  const products = await db('products')
    .where('shop_id', shopId)
    .select(['lasyncro_product_id', 'sku']);

  if (products.length === 0) {
    return {
      shopId,
      period,

      productsObserved: null,

      productsWithInventoryCount: null,
      productsWithoutInventoryCount: null,

      skusWithSalesCount: null,
      totalSkusObserved: null,

      ordersWithFulfillmentStatusCount: null,
      ordersWithoutFulfillmentStatusCount: null,

      extractedAt: new Date().toISOString(),
    };
  }

  const productsObserved = products.length;

  const skus = products
    .map(p => p.sku)
    .filter((sku): sku is string => sku !== null);

  // ─────────────────────────────────────────
  // Inventory observability (snapshot)
  // ─────────────────────────────────────────
  const inventoryRows = await db('inventory_truth')
    .where('shop_id', shopId)
    .select(['sku']);

  const inventorySkuSet = new Set(
    inventoryRows.map(r => r.sku)
  );

  let productsWithInventoryCount: number | null = null;
  let productsWithoutInventoryCount: number | null = null;

  if (skus.length > 0) {
   productsWithInventoryCount = 0;
   productsWithoutInventoryCount = 0;

   for (const sku of skus) {
     if (inventorySkuSet.has(sku)) {
       productsWithInventoryCount += 1;
     } else {
       productsWithoutInventoryCount += 1;
     }
   }
 }

  // ─────────────────────────────────────────
  // Sales observability (time-scoped, legal)
  // ─────────────────────────────────────────
  let skusWithSalesCount: number | null = null;
  let totalSkusObserved: number | null = null;

  if (skus.length > 0) {
    const salesRows = await db('historical_sales')
      .where('shop_id', shopId)
      .andWhere('sale_date', '>=', period.from)
      .andWhere('sale_date', '<=', period.to)
      .whereIn('sku', skus)
      .distinct('sku');

    skusWithSalesCount = salesRows.length;
    totalSkusObserved = skus.length;
  }

  // ─────────────────────────────────────────
  // Fulfillment observability (order-level)
  // ─────────────────────────────────────────
  const fulfillmentRows = await db('order_fulfillment_status')
    .where('shop_id', shopId)
    .select(['order_id']);

  const ordersWithFulfillmentStatusCount = fulfillmentRows.length;

  // Orders table exists, but we do NOT infer joins here.
  // Absence of fulfillment status ≠ failure.
  const ordersWithoutFulfillmentStatusCount = null;

  return {
    shopId,
    period,

    productsObserved,

    productsWithInventoryCount,
    productsWithoutInventoryCount,

    skusWithSalesCount,
    totalSkusObserved,

    ordersWithFulfillmentStatusCount,
    ordersWithoutFulfillmentStatusCount,

    extractedAt: new Date().toISOString(),
  };
}