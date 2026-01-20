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
 * - Uses ONLY existing canonical / operational tables
 * - Presence-based signals only
 * - No inference, no thresholds, no ratios
 * - Null when no observable truth exists
 *
 * FT2 NOTE:
 * - This domain observes supply *signals*, not suppliers or lead times
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

  // ─────────────────────────────────────────
  // Inventory signal presence (snapshot)
  // ─────────────────────────────────────────
  const inventoryRows = await db('inventory_truth')
    .where('shop_id', shopId)
    .whereIn('sku', skus)
    .distinct('sku');

  const inventorySkuSet = new Set(
    inventoryRows.map(r => r.sku)
  );

  const productsWithInventorySignalCount =
    inventorySkuSet.size;

  // ─────────────────────────────────────────
  // Fulfillment signal presence (order-level)
  // ─────────────────────────────────────────
  const fulfillmentRows = await db('order_fulfillment_status')
    .where('shop_id', shopId)
    .distinct('order_id');

  const hasFulfillmentSignals =
    fulfillmentRows.length > 0;

  const productsWithFulfillmentSignalCount =
    hasFulfillmentSignals ? productsObserved : 0;

  // ─────────────────────────────────────────
  // Any supply signal (union)
  // ─────────────────────────────────────────
  const productsWithAnySupplySignalCount =
    productsWithInventorySignalCount > 0 ||
    productsWithFulfillmentSignalCount > 0
      ? productsObserved
      : 0;

  return {
    shopId,
    period,

    productsObserved,

    productsWithAnySupplySignalCount,
    productsWithInventorySignalCount,
    productsWithFulfillmentSignalCount,

    extractedAt: new Date().toISOString(),
  };
}
