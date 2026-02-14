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
  const inventoryProductRows = await db('inventory_truth as it')
  .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
  .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
  .where('v.shop_id', shopId)
  .distinct('p.lasyncro_product_id');

  const productsWithInventoryCount =
    inventoryProductRows.length > 0
      ? inventoryProductRows.length
      : null;

  const productsWithoutInventoryCount =
    productsWithInventoryCount !== null
      ? productsObserved - productsWithInventoryCount
      : null;

  // ─────────────────────────────────────────
  // Sales observability (time-scoped, legal)
  // ─────────────────────────────────────────
  let skusWithSalesCount: number | null = null;
  let totalSkusObserved: number | null = null;

  const salesVariantRows = await db('order_revenue_units as ru')
    .join('orders as o', 'o.lasyncro_order_id', 'ru.lasyncro_order_id')
    .join('variants as v', 'v.lasyncro_variant_id', 'ru.lasyncro_variant_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '>=', period.from)
    .andWhere('o.order_created_at', '<=', period.to)
    .distinct('v.sku');

  if (salesVariantRows.length > 0) {
    skusWithSalesCount = salesVariantRows.length;
    totalSkusObserved = skus.length;
  }

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
  // IMPORTANT:
  // order_fulfillment_status has NO shop_id.
  // Shop scoping MUST derive via orders join.
  // Fulfillment is sovereign and order-scoped.

  const fulfillmentRows = await db('order_fulfillment_status as ofs')
    .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .select(['ofs.lasyncro_order_id']);

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