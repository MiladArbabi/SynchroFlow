// apps/backend/src/services/products-operator/ProductsOperatorFacts.service.ts
import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';

/**
 * ProductsOperatorFacts
 * ---------------------
 * Purpose-built operator facts for the Products operator summary.
 *
 * DESIGN CONTRACT:
 * - This is NOT an FTEP layer — it is a direct operator surface.
 * - Returns raw counts and lists — no downgrading, no signal lossy-ness.
 * - Period-scoped where relevant (sales, drift).
 * - Snapshot-scoped where period does not apply (inventory, SKU).
 *
 * SOURCES:
 * - variants (sellability, SKU, status)
 * - inventory_truth (sellable_quantity)
 * - order_revenue_units + orders (sales presence, period-scoped)
 * - refund_execution_line_items + order_revenue_units (returns, all-time)
 */

export interface ProductsOperatorFacts {
  shopId: number;
  period: { from: string; to: string };

  // ── Sellability (variant-level, snapshot) ──────────────────
  // Active variants with SKU and sellable_quantity > 0
  sellableCount: number | null;
  // Active variants missing SKU
  noSkuCount: number | null;
  // Active variants with no inventory_truth row
  noInventoryCount: number | null;

  // Active variants with inventory row but on_hand = 0 (genuinely empty)
  zeroStockCount: number | null;
  // Active variants with inventory row but on_hand < 0 (phantom: sold without recorded receiving)
  phantomCount: number | null;

  // ── Dead weight (period-scoped) ────────────────────────────
  // Active variants with zero order_revenue_units in period
  noSalesCount: number | null;

  // ── Catalog drift (period-scoped) ─────────────────────────
  // Variants created within period
  addedThisPeriodCount: number | null;

  // ── Top returned variants (all-time, top 5) ───────────────
 topReturned: Array<{
    lasyncro_variant_id: string;
    variantTitle: string | null;
    sku: string | null;
    unitsReturned: number;
    revenueLeakage: number;
    returnRatePct: number;
  }>;

  // Products missing SKU — grouped by product, with variant list
  // Operator needs to know WHICH products to fix, not just the count
  noSkuProducts: Array<{
    productTitle: string | null;
    variants: Array<{ variantTitle: string | null }>;
  }>;

  // Products with SKU but no inventory_truth row — never synced/received
  noInventoryProducts: Array<{
    productTitle: string | null;
    variants: Array<{ variantTitle: string | null; sku: string | null }>;
  }>;
}

export async function getProductsOperatorFacts(
  input: { shopId: number; period: { from: string; to: string } },
  trx?: Knex | Knex.Transaction
): Promise<ProductsOperatorFacts> {
  const { shopId, period } = input;
  const qb = trx ?? db;
  // Join to products to get product_type.
  // Only physical products require SKUs for warehouse operations.
  // gift_card, digital, and service products are excluded from Problem Center signals.
  const activeVariants = await qb('variants as v')
    .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
    .where({ 'v.shop_id': shopId, 'v.status': 'active' })
    .select([
      'v.lasyncro_variant_id',
      'v.sku',
      'v.title as variant_title',
      'v.created_at',
      'p.product_type',
      'p.title as product_title',
    ]);

  if (activeVariants.length === 0) {
    return {
      shopId,
      period,
      sellableCount: null,
      noSkuCount: null,
      noInventoryCount: null,
      zeroStockCount: null,
      phantomCount: null,
      noSalesCount: null,
      addedThisPeriodCount: null,
      topReturned: [],
      noSkuProducts: [],
      noInventoryProducts: [],
    };
  }

  const allVariantIds = activeVariants.map(v => v.lasyncro_variant_id);

  // ─────────────────────────────────────────
  // Inventory truth — sellable_quantity per variant
  // ─────────────────────────────────────────
  const inventoryRows = await qb('inventory_truth')
    .where('shop_id', shopId)
    .whereIn('lasyncro_variant_id', allVariantIds)
    .select(['lasyncro_variant_id', 'sellable_quantity', 'on_hand_quantity']);

    const inventoryMap = new Map(
    inventoryRows.map((r: any) => [r.lasyncro_variant_id, {
      sellable: Number(r.sellable_quantity),
      onHand: Number(r.on_hand_quantity),
    }])
  );

  // ─────────────────────────────────────────
  // Sellability classification
  // ─────────────────────────────────────────
  let sellableCount = 0;
  let noSkuCount = 0;
  let noInventoryCount = 0;
  let zeroStockCount = 0;
  let phantomCount = 0;
  for (const v of activeVariants) {
    // Non-physical products don't require SKUs — exclude from gap signal
    if (v.product_type !== 'physical') continue;
    if (v.sku === null) {
      noSkuCount++;
      continue;
    }
    // INVENTORY BLOCK: no inventory_truth row exists — absence of data.
    if (!inventoryMap.has(v.lasyncro_variant_id)) {
      noInventoryCount++;
      continue;
    }
    // A row exists. Classify by TRUE on_hand (not clamped sellable):
    //  - on_hand < 0  → PHANTOM: recorded contradiction (sold without recorded receiving)
    //  - on_hand === 0 → ZERO STOCK: genuinely empty
    //  - on_hand > 0  → SELLABLE
    const { onHand } = inventoryMap.get(v.lasyncro_variant_id)!;
    if (onHand < 0) {
      phantomCount++;
    } else if (onHand === 0) {
      zeroStockCount++;
    } else {
      sellableCount++;
    }
  }

  // ─────────────────────────────────────────
  // No-inventory variants (snapshot) — grouped for operator action
  // ─────────────────────────────────────────
  const noInventoryRows = activeVariants.filter(
    v => v.product_type === 'physical' && v.sku !== null && !inventoryMap.has(v.lasyncro_variant_id)
  );
  const noInventoryMap = new Map<string, Array<{ variantTitle: string | null; sku: string | null }>>();
  for (const row of noInventoryRows) {
    const key = (row as any).product_title ?? 'Unknown product';
    if (!noInventoryMap.has(key)) noInventoryMap.set(key, []);
    noInventoryMap.get(key)!.push({ variantTitle: (row as any).variant_title ?? null, sku: row.sku });
  }
  const noInventoryProducts = Array.from(noInventoryMap.entries()).map(([productTitle, variants]) => ({
    productTitle,
    variants,
  }));

  // ─────────────────────────────────────────
  // No-sales variants (period-scoped)
  // ─────────────────────────────────────────
  const soldVariantRows = await qb('order_revenue_units as ru')
    .join('orders as o', 'o.lasyncro_order_id', 'ru.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '>=', period.from)
    .andWhere('o.order_created_at', '<=', period.to)
    .whereIn('ru.lasyncro_variant_id', allVariantIds)
    .distinct('ru.lasyncro_variant_id');

  const soldVariantIds = new Set(soldVariantRows.map((r: any) => r.lasyncro_variant_id));
  const noSalesCount = allVariantIds.filter(id => !soldVariantIds.has(id)).length;

  // ─────────────────────────────────────────
  // Catalog drift — added this period
  // ─────────────────────────────────────────
  const addedThisPeriodCount = activeVariants.filter(v => {
    const createdAt = new Date(v.created_at);
    return createdAt >= new Date(period.from) && createdAt <= new Date(period.to);
  }).length;

  // ─────────────────────────────────────────
  // Top returned variants (all-time, top 5)
  // via refund_execution_line_items → order_revenue_units → variants
  // ─────────────────────────────────────────
  const returnRows = await qb('refund_executions as re')
    .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
    .join('refund_execution_line_items as reli', 'reli.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
    .join('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
    .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oru.lasyncro_variant_id')
    .where('o.shop_id', shopId)
    .groupBy('oru.lasyncro_variant_id', 'v.title', 'oru.sku')
    .orderByRaw('SUM(reli.refunded_quantity) DESC')
    .limit(5)
    .select(
      'oru.lasyncro_variant_id',
      'v.title as variant_title',
      'oru.sku',
      db.raw('SUM(reli.refunded_quantity) as units_returned'),
      db.raw('SUM(reli.refunded_amount) as revenue_leakage'),
      db.raw('COUNT(DISTINCT re.lasyncro_refund_execution_id) as refund_count'),
    );

  // Return rate = refund_count / total orders containing this variant
  const returnVariantIds = returnRows.map((r: any) => r.lasyncro_variant_id);

  const ordersPerVariant = returnVariantIds.length > 0
    ? await qb('order_revenue_units as oru')
        .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .whereIn('oru.lasyncro_variant_id', returnVariantIds)
        .groupBy('oru.lasyncro_variant_id')
        .select(
          'oru.lasyncro_variant_id',
          db.raw('COUNT(DISTINCT oru.lasyncro_order_id) as order_count'),
        )
    : [];

  const ordersPerVariantMap = new Map(
    ordersPerVariant.map((r: any) => [r.lasyncro_variant_id, Number(r.order_count)])
  );

  const topReturned = returnRows.map((r: any) => {
    const refundCount = Number(r.refund_count ?? 0);
    const orderCount = ordersPerVariantMap.get(r.lasyncro_variant_id) ?? 1;
    return {
      lasyncro_variant_id: r.lasyncro_variant_id,
      variantTitle: r.variant_title ?? null,
      sku: r.sku ?? null,
      unitsReturned: Number(r.units_returned ?? 0),
      revenueLeakage: Number(r.revenue_leakage ?? 0),
      returnRatePct: Math.round((refundCount / orderCount) * 1000) / 10,
    };
  });

  // Only physical products — gift cards and digital products don't need SKUs
  const noSkuRows = await qb('variants as v')
    .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
    .where('v.shop_id', shopId)
    .andWhere('v.status', 'active')
    .andWhere('p.product_type', 'physical')
    .whereNull('v.sku')
    .orderBy('p.title')
    .select('p.title as product_title', 'v.title as variant_title');

  // Group by product title
  const noSkuMap = new Map<string, Array<{ variantTitle: string | null }>>();
  for (const row of noSkuRows) {
    const key = row.product_title ?? 'Unknown product';
    if (!noSkuMap.has(key)) noSkuMap.set(key, []);
    noSkuMap.get(key)!.push({ variantTitle: row.variant_title ?? null });
  }
  const noSkuProducts = Array.from(noSkuMap.entries()).map(([productTitle, variants]) => ({
    productTitle,
    variants,
  }));

  return {
    shopId,
    period,
    sellableCount,
    noSkuCount,
    noInventoryCount,
    zeroStockCount,
    noSalesCount,
    addedThisPeriodCount,
    topReturned,
    noSkuProducts,
    noInventoryProducts,
    phantomCount
  };
}