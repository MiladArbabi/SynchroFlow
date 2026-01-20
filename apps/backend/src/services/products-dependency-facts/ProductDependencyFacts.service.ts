// apps/backend/src/services/products-dependency-facts/ProductDependencyFacts.service.ts

import db from 'api-db';
import { ProductDependencyFacts } from './ProductDependencyFacts.types';

interface GetProductDependencyFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * getProductDependencyFacts
 *
 * Layer 1 (Facts) — Product Dependency.
 *
 * GUARANTEES:
 * - Presence-only observability
 * - No joins implying correctness
 * - No inference, scoring, or risk
 * - Null when no canonical products exist
 */
export async function getProductDependencyFacts(
  input: GetProductDependencyFactsInput
): Promise<ProductDependencyFacts> {
  const { shopId, period } = input;

  // ─────────────────────────────────────────
  // Canonical product baseline
  // ─────────────────────────────────────────
  const products = await db('canonical_products')
    .where('shop_id', shopId)
    .select(['sku']);

  if (products.length === 0) {
    return {
      shopId,
      period,

      productsObserved: null,

      productsTouchingInventoryCount: null,
      productsTouchingSalesCount: null,
      productsTouchingFulfillmentCount: null,
      productsTouchingCostsCount: null,

      systemsTouchedPerProductAvg: null,
      productsTouchingMultipleSystemsCount: null,

      extractedAt: new Date().toISOString(),
    };
  }

  const productsObserved = products.length;

  const skus = products
    .map(p => p.sku)
    .filter((sku): sku is string => sku !== null);

  // ─────────────────────────────────────────
  // Presence scans (independent, legal)
  // ─────────────────────────────────────────
  const inventorySkus = new Set(
    (await db('inventory_truth')
      .where('shop_id', shopId)
      .select(['sku']))
      .map(r => r.sku)
  );

  const salesSkus = new Set(
    (await db('historical_sales')
      .where('shop_id', shopId)
      .andWhere('sale_date', '>=', period.from)
      .andWhere('sale_date', '<=', period.to)
      .distinct('sku'))
      .map(r => r.sku)
  );

  const fulfillmentOrders = await db('order_fulfillment_status')
    .where('shop_id', shopId)
    .select(['order_id']);

  // Cost presence is product-level, not SKU-level
  const [{ c }] = await db('product_costs').count('* as c');

  const hasAnyCostSignals = Number(c) > 0;

  // ─────────────────────────────────────────
  // Per-product coupling count
  // ─────────────────────────────────────────
  let productsTouchingInventoryCount = 0;
  let productsTouchingSalesCount = 0;
  let productsTouchingCostsCount = 0;

  let systemsTouchedTotal = 0;
  let productsTouchingMultipleSystemsCount = 0;
  let productsTouchingFulfillmentCount = 0;

  for (const sku of skus) {
    let touched = 0;

    if (inventorySkus.has(sku)) {
      productsTouchingInventoryCount += 1;
      touched += 1;
    }

    if (salesSkus.has(sku)) {
      productsTouchingSalesCount += 1;
      touched += 1;
    }

    // Fulfillment is order-level, presence-only
    if (fulfillmentOrders.length > 0) {
      productsTouchingFulfillmentCount += 1;
      touched += 1;
    }

    systemsTouchedTotal += touched;

    if (touched > 1) {
      productsTouchingMultipleSystemsCount += 1;
    }
  }

  // ─────────────────────────────────────────
  // Cost coupling (product-level, non-SKU)
  // ─────────────────────────────────────────
  productsTouchingCostsCount = hasAnyCostSignals
    ? productsObserved
    : 0;

  const systemsTouchedPerProductAvg =
    skus.length > 0
      ? systemsTouchedTotal / skus.length
      : null;

  return {
    shopId,
    period,

    productsObserved,

    productsTouchingInventoryCount,
    productsTouchingSalesCount,
    productsTouchingFulfillmentCount:
      fulfillmentOrders.length > 0 ? productsObserved : 0,
    productsTouchingCostsCount,

    systemsTouchedPerProductAvg,
    productsTouchingMultipleSystemsCount,

    extractedAt: new Date().toISOString(),
  };
}