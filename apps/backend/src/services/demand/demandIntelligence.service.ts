// apps/backend/src/services/demand/demandIntelligence.service.ts

import db from '@lasyncro/backend-core/db.js';

/**
 * DEMAND INTELLIGENCE SERVICE (DF-01, DF-02, DF-03)
 * ---------------------------------------------------
 * Computes demand velocity, days-of-stock-remaining,
 * and reorder signals per variant.
 *
 * METHODOLOGY:
 * - Velocity = units sold / days in observation window
 * - Days of stock = available_quantity / velocity
 * - Reorder signal fires when days of stock < reorder_threshold
 *
 * SOURCES:
 * - order_revenue_units → units sold per variant
 * - inventory_truth → current available stock
 * - variants → unit cost, title, SKU
 * - orders → order timing for velocity window
 *
 * RULES:
 * - Read-only — never writes
 * - Shop-scoped — always filters by shop_id
 * - Velocity computed over rolling 30-day window
 * - Reorder threshold: 14 days of stock remaining
 */

export type DemandVelocity = {
  lasyncro_variant_id: string;
  title: string | null;
  sku: string | null;
  unit_cost: number | null;
  available_quantity: number;
  units_sold_30d: number;
  units_sold_all_time: number;
  velocity_per_day: number;
  days_of_stock_remaining: number | null;
  reorder_signal: boolean;
  reorder_urgency: 'critical' | 'warning' | 'healthy' | 'overstocked' | 'no_velocity';
  estimated_stockout_date: string | null;
};

export type DemandSummary = {
  total_variants_tracked: number;
  critical_reorder_count: number;
  warning_reorder_count: number;
  stockout_count: number;
  avg_days_of_stock: number | null;
  total_inventory_value: number;
};

export type DemandIntelligenceResult = {
  summary: DemandSummary;
  variants: DemandVelocity[];
  computed_at: string;
};

const VELOCITY_WINDOW_DAYS = 30;
const REORDER_THRESHOLD_DAYS = 14;
const CRITICAL_THRESHOLD_DAYS = 7;

function deriveUrgency(
  daysOfStock: number | null,
  velocityPerDay: number,
  availableQty: number
): 'critical' | 'warning' | 'healthy' | 'overstocked' | 'no_velocity' {
  if (velocityPerDay === 0) return 'no_velocity';
  if (availableQty <= 0) return 'critical';
  if (daysOfStock === null) return 'no_velocity';
  if (daysOfStock <= CRITICAL_THRESHOLD_DAYS) return 'critical';
  if (daysOfStock <= REORDER_THRESHOLD_DAYS) return 'warning';
  if (daysOfStock > 90) return 'overstocked';
  return 'healthy';
}

export async function computeDemandIntelligence(
  shopId: number
): Promise<DemandIntelligenceResult> {
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - VELOCITY_WINDOW_DAYS);

    /**
     * 30-DAY VELOCITY PER VARIANT
     */
    const velocity30d = await trx('order_revenue_units as oru')
      .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .where('o.order_created_at', '>=', windowStart)
      .groupBy('oru.lasyncro_variant_id')
      .select(
        'oru.lasyncro_variant_id',
        trx.raw('SUM(oru.quantity) as units_sold_30d'),
      );

    const velocity30dMap = new Map(
      velocity30d.map((r: any) => [r.lasyncro_variant_id, Number(r.units_sold_30d)])
    );

    /**
     * ALL-TIME UNITS SOLD PER VARIANT
     */
    const allTimeSales = await trx('order_revenue_units as oru')
      .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .groupBy('oru.lasyncro_variant_id')
      .select(
        'oru.lasyncro_variant_id',
        trx.raw('SUM(oru.quantity) as units_sold_all_time'),
      );

    const allTimeSalesMap = new Map(
      allTimeSales.map((r: any) => [r.lasyncro_variant_id, Number(r.units_sold_all_time)])
    );

    /**
     * INVENTORY TRUTH + VARIANT DETAILS
     */
    const inventoryRows = await trx('inventory_truth as it')
      .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
      .where('it.shop_id', shopId)
      .select(
        'it.lasyncro_variant_id',
        'it.available_quantity',
        'v.title',
        'v.unit_cost',
        trx.raw('COALESCE(v.sku, NULL) as sku'),
      );

    /**
     * BUILD PER-VARIANT DEMAND RECORDS
     * Only include variants that have had sales or have stock
     */
    const variants: DemandVelocity[] = inventoryRows
      .map((row: any) => {
        const units30d = velocity30dMap.get(row.lasyncro_variant_id) ?? 0;
        const unitsAllTime = allTimeSalesMap.get(row.lasyncro_variant_id) ?? 0;
        const availableQty = Number(row.available_quantity ?? 0);
        const velocityPerDay = Math.round((units30d / VELOCITY_WINDOW_DAYS) * 100) / 100;

        const daysOfStock =
          velocityPerDay > 0
            ? Math.round(availableQty / velocityPerDay)
            : null;

        const urgency = deriveUrgency(daysOfStock, velocityPerDay, availableQty);
        const reorderSignal = urgency === 'critical' || urgency === 'warning';

        const stockoutDate =
          daysOfStock != null && velocityPerDay > 0
            ? new Date(Date.now() + daysOfStock * 24 * 60 * 60 * 1000).toISOString()
            : null;

        return {
          lasyncro_variant_id: row.lasyncro_variant_id,
          title: row.title ?? null,
          sku: row.sku ?? null,
          unit_cost: row.unit_cost != null ? Number(row.unit_cost) : null,
          available_quantity: availableQty,
          units_sold_30d: units30d,
          units_sold_all_time: unitsAllTime,
          velocity_per_day: velocityPerDay,
          days_of_stock_remaining: daysOfStock,
          reorder_signal: reorderSignal,
          reorder_urgency: urgency,
          estimated_stockout_date: stockoutDate,
        };
      })
      .filter((v: DemandVelocity) => v.units_sold_all_time > 0 || v.available_quantity > 0)
      .sort((a: DemandVelocity, b: DemandVelocity) => {
        const urgencyOrder = { critical: 0, warning: 1, healthy: 2, no_velocity: 3, overstocked: 4 };
        return (urgencyOrder[a.reorder_urgency] ?? 5) - (urgencyOrder[b.reorder_urgency] ?? 5);
      });

    /**
     * SUMMARY
     */
    const variantsWithVelocity = variants.filter(v => v.velocity_per_day > 0);
    const avgDaysOfStock =
      variantsWithVelocity.length > 0
        ? Math.round(
            variantsWithVelocity
              .filter(v => v.days_of_stock_remaining !== null)
              .reduce((s, v) => s + (v.days_of_stock_remaining ?? 0), 0) /
            variantsWithVelocity.length
          )
        : null;

    const totalInventoryValue = variants.reduce((s, v) => {
      if (v.unit_cost && v.available_quantity > 0) {
        return s + v.unit_cost * v.available_quantity;
      }
      return s;
    }, 0);

    const summary: DemandSummary = {
      total_variants_tracked: variants.length,
      critical_reorder_count: variants.filter(v => v.reorder_urgency === 'critical').length,
      warning_reorder_count: variants.filter(v => v.reorder_urgency === 'warning').length,
      stockout_count: variants.filter(v => v.available_quantity <= 0).length,
      avg_days_of_stock: avgDaysOfStock,
      total_inventory_value: Math.round(totalInventoryValue * 100) / 100,
    };

    return { summary, variants, computed_at: new Date().toISOString() };
  });
}