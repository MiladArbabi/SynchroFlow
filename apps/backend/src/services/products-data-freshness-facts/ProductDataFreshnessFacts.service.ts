// apps/backend/src/services/products-data-freshness-facts/ProductDataFreshnessFacts.service.ts

import db from 'api-db';
import { ProductDataFreshnessFacts } from './ProductDataFreshnessFacts.types';

interface GetProductDataFreshnessFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * getProductDataFreshnessFacts
 *
 * Layer 1 (Facts) — Data Freshness & Trust Latency
 *
 * GUARANTEES:
 * - Schema-backed timestamps only
 * - MAX(timestamp) per domain
 * - No interpretation
 * - No thresholds
 * - Null-preserving
 */
export async function getProductDataFreshnessFacts(
  input: GetProductDataFreshnessFactsInput
): Promise<ProductDataFreshnessFacts> {
  const { shopId, period } = input;

  // ─────────────────────────────────────────
  // Structural — canonical_products.updated_at
  // ─────────────────────────────────────────
  const structural = await db('canonical_products')
    .where('shop_id', shopId)
    .max('updated_at as ts')
    .first();

  // ─────────────────────────────────────────
  // Inventory — inventory_truth.updated_at
  // ─────────────────────────────────────────
  const inventory = await db('inventory_truth')
    .where('shop_id', shopId)
    .max('updated_at as ts')
    .first();

  // ─────────────────────────────────────────
  // Sales — historical_sales.sale_date (time-scoped)
  // ─────────────────────────────────────────
  const sales = await db('historical_sales')
    .where('shop_id', shopId)
    .andWhere('sale_date', '>=', period.from)
    .andWhere('sale_date', '<=', period.to)
    .max('sale_date as ts')
    .first();

  // ─────────────────────────────────────────
  // Fulfillment — order_fulfillment_status.status_updated_at
  // ─────────────────────────────────────────
  const fulfillment = await db('order_fulfillment_status')
    .where('shop_id', shopId)
    .max('status_updated_at as ts')
    .first();

  // ─────────────────────────────────────────
  // Costs — product_costs.updated_at
  // ─────────────────────────────────────────
  const costs = await db('product_costs')
    .max('updated_at as ts')
    .first();

  return {
    shopId,
    period,

    structuralLastObservedAt: structural?.ts ?? null,
    inventoryLastObservedAt: inventory?.ts ?? null,
    salesLastObservedAt: sales?.ts ?? null,
    fulfillmentLastObservedAt: fulfillment?.ts ?? null,
    costLastObservedAt: costs?.ts ?? null,

    extractedAt: new Date().toISOString(),
  };
}