// apps/backend/src/services/returns/returnsIntelligence.service.ts

import db from '@lasyncro/backend-core/db.js';

/**
 * RETURNS INTELLIGENCE SERVICE (RT-01)
 * -------------------------------------
 * Computes return rate, revenue leakage, and restocking rate
 * from refund_executions, order_revenue_units, and inventory_movements.
 *
 * SOURCES:
 * - refund_executions → which orders were refunded
 * - order_revenue_units → line item revenue and cost per order
 * - inventory_movements (refund_return) → restocking events
 *
 * INVARIANTS:
 * - Read-only — never writes to projection tables
 * - Shop-scoped — always filters by shop_id
 * - Returns empty arrays when no data exists
 */

export type ReturnsSummary = {
  total_refunds: number;
  total_revenue_refunded: number;
  total_margin_leakage: number;
  avg_return_rate_pct: number;
  total_units_returned: number;
  total_units_restocked: number;
  restock_rate_pct: number;
};

export type ReturnsByVariant = {
  lasyncro_variant_id: string;
  variant_title: string | null;
  sku: string | null;
  total_refunds: number;
  total_units_returned: number;
  total_units_restocked: number;
  revenue_leakage: number;
  margin_leakage: number | null;
  return_rate_pct: number;
  restock_rate_pct: number;
};

export type ReturnsIntelligenceResult = {
  summary: ReturnsSummary;
  by_variant: ReturnsByVariant[];
};

/**
 * computeReturnsIntelligence
 * --------------------------
 * Main entry point. Returns shop-level summary and per-variant breakdown.
 */
export async function computeReturnsIntelligence(
  shopId: number
): Promise<ReturnsIntelligenceResult> {
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    /**
     * SHOP-LEVEL SUMMARY
     * ------------------
     * Aggregate refund revenue and margin leakage.
     */
    // Join through refund_execution_line_items to scope to refunded lines only.
    // Direct join on lasyncro_order_id fans out to all line items — incorrect.
    const summaryRow = await trx('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .join('refund_execution_line_items as reli', 'reli.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
      .join('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .where('o.shop_id', shopId)
      .select(
        trx.raw('COUNT(DISTINCT re.lasyncro_refund_execution_id) as total_refunds'),
        trx.raw('COALESCE(SUM(oru.line_total), 0) as total_revenue_refunded'),
        trx.raw(`
          COALESCE(SUM(
            CASE
              WHEN oru.estimated_unit_cost IS NOT NULL
              THEN oru.line_total - (oru.quantity * oru.estimated_unit_cost)
              ELSE NULL
            END
          ), 0) as total_margin_leakage
        `),
        // Use refunded_quantity from line items — not the original order quantity
        trx.raw('COALESCE(SUM(reli.refunded_quantity), 0) as total_units_returned'),
      )
      .first();

    /**
     * RESTOCKED UNITS
     * ---------------
     * Count refund_return movements for this shop.
     */
    const restockRow = await trx('inventory_movements')
      .where({ shop_id: shopId, movement_type: 'refund_return' })
      .sum('quantity_delta as total_restocked')
      .first();

    const totalRefunds = Number(summaryRow?.total_refunds ?? 0);
    const totalRevenueRefunded = Number(summaryRow?.total_revenue_refunded ?? 0);
    const totalMarginLeakage = Number(summaryRow?.total_margin_leakage ?? 0);
    const totalUnitsReturned = Number(summaryRow?.total_units_returned ?? 0);
    const totalUnitsRestocked = Number(restockRow?.total_restocked ?? 0);
    const restockRatePct = totalUnitsReturned > 0
      ? Math.round((totalUnitsRestocked / totalUnitsReturned) * 1000) / 10
      : 0;

    /**
     * TOTAL ORDERS (for return rate computation)
     */
    const totalOrdersRow = await trx('orders')
      .where({ shop_id: shopId })
      .count('lasyncro_order_id as total')
      .first();
    const totalOrders = Number(totalOrdersRow?.total ?? 1);
    const avgReturnRatePct = Math.round((totalRefunds / totalOrders) * 1000) / 10;

    const summary: ReturnsSummary = {
      total_refunds: totalRefunds,
      total_revenue_refunded: totalRevenueRefunded,
      total_margin_leakage: totalMarginLeakage,
      avg_return_rate_pct: avgReturnRatePct,
      total_units_returned: totalUnitsReturned,
      total_units_restocked: totalUnitsRestocked,
      restock_rate_pct: restockRatePct,
    };

    /**
     * PER-VARIANT BREAKDOWN
     * ---------------------
     * Return rate, revenue leakage, and restock rate per variant.
     */
    const variantRows = await trx('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .join('refund_execution_line_items as reli', 'reli.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
      .join('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oru.lasyncro_variant_id')
      .where('o.shop_id', shopId)
      .groupBy('oru.lasyncro_variant_id', 'v.title', 'oru.sku')
      .select(
        'oru.lasyncro_variant_id',
        'v.title as variant_title',
        'oru.sku',
        trx.raw('COUNT(DISTINCT re.lasyncro_refund_execution_id) as total_refunds'),
        trx.raw('SUM(reli.refunded_quantity) as total_units_returned'),
        trx.raw('SUM(reli.refunded_amount) as revenue_leakage'),
        trx.raw(`
          SUM(
            CASE
              WHEN oru.estimated_unit_cost IS NOT NULL
              THEN oru.line_total - (oru.quantity * oru.estimated_unit_cost)
              ELSE NULL
            END
          ) as margin_leakage
        `),
      );

    /**
     * RESTOCK RATE PER VARIANT
     * ------------------------
     */
    const restockByVariant = await trx('inventory_movements')
      .where({ shop_id: shopId, movement_type: 'refund_return' })
      .groupBy('lasyncro_variant_id')
      .select(
        'lasyncro_variant_id',
        trx.raw('SUM(quantity_delta) as restocked_quantity'),
      );

    const restockMap = new Map(
      restockByVariant.map((r: any) => [r.lasyncro_variant_id, Number(r.restocked_quantity)])
    );

    /**
     * TOTAL ORDERS PER VARIANT (for return rate)
     */
    const ordersPerVariant = await trx('order_revenue_units as oru')
      .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .groupBy('oru.lasyncro_variant_id')
      .select(
        'oru.lasyncro_variant_id',
        trx.raw('COUNT(DISTINCT oru.lasyncro_order_id) as order_count'),
      );

    const ordersPerVariantMap = new Map(
      ordersPerVariant.map((r: any) => [r.lasyncro_variant_id, Number(r.order_count)])
    );

    const byVariant: ReturnsByVariant[] = variantRows.map((row: any) => {
      const unitsReturned = Number(row.total_units_returned ?? 0);
      const unitsRestocked = restockMap.get(row.lasyncro_variant_id) ?? 0;
      const variantOrderCount = ordersPerVariantMap.get(row.lasyncro_variant_id) ?? 1;
      const refundCount = Number(row.total_refunds ?? 0);

      return {
        lasyncro_variant_id: row.lasyncro_variant_id,
        variant_title: row.variant_title ?? null,
        sku: row.sku ?? null,
        total_refunds: refundCount,
        total_units_returned: unitsReturned,
        total_units_restocked: unitsRestocked,
        revenue_leakage: Number(row.revenue_leakage ?? 0),
        margin_leakage: row.margin_leakage != null ? Number(row.margin_leakage) : null,
        return_rate_pct: Math.round((refundCount / variantOrderCount) * 1000) / 10,
        restock_rate_pct: unitsReturned > 0
          ? Math.round((unitsRestocked / unitsReturned) * 1000) / 10
          : 0,
      };
    });

    return { summary, by_variant: byVariant };
  });
}