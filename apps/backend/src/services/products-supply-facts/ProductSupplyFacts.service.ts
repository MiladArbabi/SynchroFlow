// apps/backend/src/services/products-supply-facts/ProductSupplyFacts.service.ts

import db from 'api-db';
import { ProductSupplyFacts } from './ProductSupplyFacts.types';

interface GetProductSupplyFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * getProductSupplyFacts
 *
 * Layer 1 (Facts) — Supply & Replenishment Reality (Signal-Based).
 *
 * GUARANTEES:
 * - Presence-based evidence only
 * - No inference, no fan-out
 * - null ≠ 0 strictly enforced
 * - SKU-backed signals only counted at product level
 */
export async function getProductSupplyFacts(
  input: GetProductSupplyFactsInput
): Promise<ProductSupplyFacts> {
  const { shopId, period } = input;

  // ─────────────────────────────────────────
  // Canonical products (snapshot)
  // ─────────────────────────────────────────
  const products = await db('canonical_products')
    .where('shop_id', shopId)
    .select(['sku']);

  if (products.length === 0) {
    return {
      shopId,
      period,

      productsObserved: null,

      productsWithAnySupplySignalCount: null,
      productsWithInventorySignalCount: null,
      productsWithFulfillmentSignalCount: null,

      extractedAt: new Date().toISOString(),
    };
  }

  const productsObserved = products.length;

  const skus = products
    .map(p => p.sku)
    .filter((sku): sku is string => sku !== null);

  // If no SKUs exist, no product-level supply is observable
  if (skus.length === 0) {
    return {
      shopId,
      period,

      productsObserved,

      productsWithAnySupplySignalCount: null,
      productsWithInventorySignalCount: null,
      productsWithFulfillmentSignalCount: null,

      extractedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────
  // Inventory signal presence (SKU-backed)
  // ─────────────────────────────────────────
  const inventoryRows = await db('inventory_truth')
    .where('shop_id', shopId)
    .whereIn('sku', skus)
    .distinct('sku');

  const productsWithInventorySignalCount =
    inventoryRows.length > 0 ? inventoryRows.length : null;

  // ─────────────────────────────────────────
  // Fulfillment signal presence (order-level only)
  // ─────────────────────────────────────────
  const fulfillmentRows = await db('order_fulfillment_status')
    .where('shop_id', shopId)
    .limit(1);

  const productsWithFulfillmentSignalCount =
    fulfillmentRows.length > 0 ? null : null;
  // NOTE:
  // Fulfillment does NOT produce product-level counts.
  // Presence contributes ONLY to union logic below.

  // ─────────────────────────────────────────
  // Any supply signal (evidence-backed union)
  // ─────────────────────────────────────────
  const hasAnySupplySignal =
    (productsWithInventorySignalCount !== null) ||
    fulfillmentRows.length > 0;

  const productsWithAnySupplySignalCount =
    hasAnySupplySignal ? productsObserved : null;

  return {
    shopId,
    period,

    productsObserved,

    productsWithAnySupplySignalCount,
    productsWithInventorySignalCount,
    productsWithFulfillmentSignalCount: null,

    extractedAt: new Date().toISOString(),
  };
}
