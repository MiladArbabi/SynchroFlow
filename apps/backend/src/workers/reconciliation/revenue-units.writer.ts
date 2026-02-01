// apps/backend/src/workers/reconciliation/revenue-units.writer.ts

import db from 'api-src/db';

/**
 * Revenue Unit Writer (v1)
 * -----------------------
 * Purpose:
 * - Materialize SKU-level revenue units
 * - Canonical source for customer obligation evaluation
 *
 * Guarantees:
 * - Zero inference
 * - Sum(quantity * unit_revenue) == order total
 *
 * Called ONLY from reconciliation.
 */

/**
 * IMPORTANT:
 * ----------
 * Revenue units require factual unit_price.
 *
 * unit_price MUST be:
 * - Platform-reported
 * - Explicitly written at ingestion time
 *
 * Deriving unit_price from totals is forbidden.
 * Absence of unit_price correctly blocks customer obligation.
 */

export async function writeOrderRevenueUnits(
  shopId: number,
  canonicalOrderId: string
) {

  // 2. Fetch canonical line items
  const rows = await db('canonical_order_line_items')
    .where({ shop_id: shopId, canonical_order_id: canonicalOrderId })
    .select(
      'canonical_variant_code',
      'sku',
      'quantity',
      'unit_price'
    );

const total = rows.length;

const missingUnitPrice = rows.filter(r => r.unit_price == null).length;
const missingCvc = rows.filter(r => !r.canonical_variant_code).length;

if (total > 0 && (missingUnitPrice > 0 || missingCvc > 0)) {
  console.warn('[revenue-units][diagnostic]', {
    shopId,
    canonicalOrderId,
    totalLineItems: total,
    missingUnitPrice,
    missingCanonicalVariantCode: missingCvc,
    blockedReason:
      missingUnitPrice > 0 && missingCvc > 0
        ? 'MISSING_PRICE_AND_CVC'
        : missingUnitPrice > 0
          ? 'MISSING_UNIT_PRICE'
          : 'MISSING_CVC',
  });
}

// HARD STOP — revenue units must be addressable
if (rows.some(r => !r.canonical_variant_code)) {
  throw new Error(
    `[CVC] Missing canonical_variant_code for order ${canonicalOrderId}`
  );
}

if (rows.length === 0) {
  const totalLineItems = await db('canonical_order_line_items')
    .where({ shop_id: shopId, canonical_order_id: canonicalOrderId })
    .count<{ count: string }>('id as count')
    .first();

  const missingUnitPrice = await db('canonical_order_line_items')
    .where({ shop_id: shopId, canonical_order_id: canonicalOrderId })
    .whereNull('unit_price')
    .count<{ count: string }>('id as count')
    .first();

  const missingCvc = await db('canonical_order_line_items')
    .where({ shop_id: shopId, canonical_order_id: canonicalOrderId })
    .whereNull('canonical_variant_code')
    .count<{ count: string }>('id as count')
    .first();

  console.warn('[revenue-units][absent]', {
    shopId,
    canonicalOrderId,
    totalLineItems: Number(totalLineItems?.count ?? 0),
    missingUnitPrice: Number(missingUnitPrice?.count ?? 0),
    missingCanonicalVariantCode: Number(missingCvc?.count ?? 0),
  });

  return;
}

  if (rows.length === 0) return;

  /**
 * NOTE (CVC):
 * ----------
 * SKU is NOT a canonical identifier.
 * canonical_variant_code (CVC) is LaSyncro’s unit of truth.
 *
 * Reasons:
 * - Merchants omit SKUs
 * - SKUs mutate
 * - Warehouses need stable codes
 */

  // 3. Insert factual units
  await db('order_revenue_units')
  .insert(
    rows.map((r) => ({
      shop_id: shopId,
      canonical_order_id: canonicalOrderId,

      // Canonical identifier (REQUIRED)
      sku: r.canonical_variant_code,

      quantity: r.quantity,
      unit_revenue: r.unit_price,
    }))
  )
  .onConflict([
    'shop_id',
    'canonical_order_id',
    'sku',
  ])
  .ignore();
}
