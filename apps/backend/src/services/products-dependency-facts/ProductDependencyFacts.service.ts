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
 * - Presence-only evidence
 * - SKU-backed counts only
 * - No fan-out inference
 * - null ≠ 0 strictly enforced
 */
export async function getProductDependencyFacts(
  input: GetProductDependencyFactsInput
): Promise<ProductDependencyFacts> {
  const { shopId, period } = input;

  // ─────────────────────────────────────────
  // Canonical product baseline
  // ─────────────────────────────────────────
  const products = await db('products')
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

  if (skus.length === 0) {
    return {
      shopId,
      period,

      productsObserved,

      productsTouchingInventoryCount: null,
      productsTouchingSalesCount: null,
      productsTouchingFulfillmentCount: null,
      productsTouchingCostsCount: null,

      systemsTouchedPerProductAvg: null,
      productsTouchingMultipleSystemsCount: null,

      extractedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────
  // SKU-backed presence scans
  // ─────────────────────────────────────────
  const inventorySkus = new Set(
    (await db('inventory_truth')
      .where('shop_id', shopId)
      .whereIn('sku', skus)
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

  let productsTouchingInventoryCount = 0;
  let productsTouchingSalesCount = 0;

  let systemsTouchedTotal = 0;
  let productsTouchingMultipleSystemsCount = 0;

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

    systemsTouchedTotal += touched;

    if (touched > 1) {
      productsTouchingMultipleSystemsCount += 1;
    }
  }

  const hasAnyInventory = productsTouchingInventoryCount > 0;
  const hasAnySales = productsTouchingSalesCount > 0;

  const systemsTouchedPerProductAvg =
    hasAnyInventory || hasAnySales
      ? systemsTouchedTotal / skus.length
      : null;

  // ─────────────────────────────────────────
  // Non-SKU systems (presence only)
  // ─────────────────────────────────────────
  const hasFulfillmentSignals =
    (await db('order_fulfillment_status')
      .where('shop_id', shopId)
      .limit(1)).length > 0;

  const hasCostSignals =
    Number(
      (await db('product_costs')
        .where('shop_id', shopId)
        .count('* as c'))[0].c
    ) > 0;

  return {
    shopId,
    period,

    productsObserved,

    productsTouchingInventoryCount:
      hasAnyInventory ? productsTouchingInventoryCount : null,

    productsTouchingSalesCount:
      hasAnySales ? productsTouchingSalesCount : null,

    productsTouchingFulfillmentCount: null,
    productsTouchingCostsCount: null,

    systemsTouchedPerProductAvg,
    productsTouchingMultipleSystemsCount:
      systemsTouchedPerProductAvg !== null
        ? productsTouchingMultipleSystemsCount
        : null,

    extractedAt: new Date().toISOString(),
  };
}
