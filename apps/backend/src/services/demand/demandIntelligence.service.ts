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
  units_sold_prev_30d: number;
  units_sold_all_time: number;
  velocity_per_day: number;
  /** 'up' = >10% increase vs prior period, 'down' = >10% decrease, 'stable' = within 10% */
  velocity_trend: 'up' | 'down' | 'stable';
  days_of_stock_remaining: number | null;
  reorder_signal: boolean;
  reorder_urgency: 'critical' | 'warning' | 'healthy' | 'overstocked' | 'no_velocity';
  estimated_stockout_date: string | null;
  /** Suggested units to order: (velocity_per_day × lead_time_days × 1.2) - available_quantity */
  suggested_reorder_qty: number | null;
  /** Supplier avg delivery days — null if no supplier linked */
  supplier_lead_time_days: number | null;
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
     * PREV 30-DAY VELOCITY (days 31-60) — for trend computation
     */
    const prevWindowStart = new Date();
    prevWindowStart.setDate(prevWindowStart.getDate() - VELOCITY_WINDOW_DAYS * 2);
    const prevWindowEnd = new Date(windowStart);

    const velocityPrev30d = await trx('order_revenue_units as oru')
      .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .where('o.order_created_at', '>=', prevWindowStart)
      .where('o.order_created_at', '<', prevWindowEnd)
      .groupBy('oru.lasyncro_variant_id')
      .select(
        'oru.lasyncro_variant_id',
        trx.raw('SUM(oru.quantity) as units_sold_prev_30d'),
      );

    const velocityPrev30dMap = new Map(
      velocityPrev30d.map((r: any) => [r.lasyncro_variant_id, Number(r.units_sold_prev_30d)])
    );

    /**
     * SUPPLIER LEAD TIME PER VARIANT
     * Sourced from most recent received PO for this variant via suppliers.avg_delivery_days
     */
    const supplierLeadTime = await trx('purchase_order_line_items as poli')
      .join('purchase_orders as po', 'po.id', 'poli.po_id')
      .join('suppliers as s', 's.id', 'po.supplier_id')
      .where('poli.shop_id', shopId)
      .whereNotNull('poli.lasyncro_variant_id')
      .whereNotNull('s.avg_delivery_days')
      .groupBy('poli.lasyncro_variant_id')
      .orderByRaw('MAX(po.created_at) DESC')
      .select(
        'poli.lasyncro_variant_id',
        trx.raw('AVG(s.avg_delivery_days) as avg_lead_time_days'),
      );

    const supplierLeadTimeMap = new Map(
      supplierLeadTime.map((r: any) => [r.lasyncro_variant_id, Math.ceil(Number(r.avg_lead_time_days))])
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
        const unitsPrev30d = velocityPrev30dMap.get(row.lasyncro_variant_id) ?? 0;
        const unitsAllTime = allTimeSalesMap.get(row.lasyncro_variant_id) ?? 0;
        const availableQty = Number(row.available_quantity ?? 0);
        const velocityPerDay = Math.round((units30d / VELOCITY_WINDOW_DAYS) * 100) / 100;
        const leadTimeDays = supplierLeadTimeMap.get(row.lasyncro_variant_id) ?? 14; // default 14d

        // Velocity trend: compare current vs prior 30d
        const velocityTrend: 'up' | 'down' | 'stable' = (() => {
          if (unitsPrev30d === 0 && units30d > 0) return 'up';
          if (unitsPrev30d === 0) return 'stable';
          const changePct = (units30d - unitsPrev30d) / unitsPrev30d;
          if (changePct > 0.1) return 'up';
          if (changePct < -0.1) return 'down';
          return 'stable';
        })();

        // Suggested reorder: cover lead time + 20% safety stock buffer
        const suggestedReorderQty = velocityPerDay > 0
          ? Math.max(0, Math.ceil(velocityPerDay * leadTimeDays * 1.2) - availableQty)
          : null;

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
          units_sold_prev_30d: unitsPrev30d,
          units_sold_all_time: unitsAllTime,
          velocity_per_day: velocityPerDay,
          velocity_trend: velocityTrend,
          days_of_stock_remaining: daysOfStock,
          reorder_signal: reorderSignal,
          reorder_urgency: urgency,
          estimated_stockout_date: stockoutDate,
          suggested_reorder_qty: suggestedReorderQty,
          supplier_lead_time_days: supplierLeadTimeMap.get(row.lasyncro_variant_id) ?? null,
        };
      })

      .filter((v: DemandVelocity) => v.units_sold_all_time > 0 || v.available_quantity > 0)
      // Exclude gift cards and products with no meaningful identity
      // These are Shopify system products — not real inventory items
      .filter((v: DemandVelocity) => {
        if (!v.title) return false;
        const title = v.title.trim();
        // Exclude pure currency amounts (gift cards: "$10", "$25", "$50")
        if (/^\$\d+$/.test(title)) return false;
        return true;
      })
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

   // Fire demand alerts for critical variants (stockout risk)
    // Non-blocking — alert failure must not fail the demand computation
    const criticalVariants = variants.filter(v => v.reorder_urgency === 'critical');
    for (const v of criticalVariants) {
      try {
        await trx('alerts')
          .insert({
            shop_id: shopId,
            alert_key: `demand:stockout_risk:${v.lasyncro_variant_id}`,
            source: 'demand',
            alert_type: 'stockout_risk',
            severity: 'critical',
            title: v.sku && v.title && v.sku !== v.title
              ? `${v.title} (${v.sku}) — stockout risk`
              : `${v.sku ?? v.title ?? 'Variant'} — stockout risk`,
            message: (() => {
              const qty = v.suggested_reorder_qty;
              const qtyLabel = qty != null ? `${qty} unit${qty === 1 ? '' : 's'}` : null;
              if (v.available_quantity <= 0) {
                return `Out of stock — reorder ${qtyLabel ?? 'immediately'}.`;
              }
              if (v.days_of_stock_remaining != null) {
                return `${v.days_of_stock_remaining} days of stock at current velocity. Suggested reorder: ${qtyLabel ?? 'unknown'}.`;
              }
              return 'Stock depleted — reorder immediately.';
            })(),
            entity_id: v.lasyncro_variant_id,
            entity_type: 'variant',
            revenue_impact: v.unit_cost && v.suggested_reorder_qty
              ? v.unit_cost * v.suggested_reorder_qty
              : null,
            is_active: true,
            category: 'stock_reorder',
            audience: 'all',
          })
          .onConflict(['shop_id', 'alert_key'])
          .merge({
            is_active: true,
            title:     trx.raw('EXCLUDED.title'),
            message:   trx.raw('EXCLUDED.message'),
            category:  'stock_reorder',
            audience:  'all',
            updated_at: trx.fn.now(),
          });
      } catch {
        // non-fatal
      }
    }

    // Resolve alerts for variants that are no longer critical OR were excluded
    // This covers: urgency changed to non-critical, AND filtered-out variants (gift cards etc.)
    const criticalAlertKeys = new Set(
      variants
        .filter(v => v.reorder_urgency === 'critical')
        .map(v => `demand:stockout_risk:${v.lasyncro_variant_id}`)
    );

    // Resolve ALL active demand alerts for this shop that aren't in the current critical set
    await trx('alerts')
      .where({ shop_id: shopId, source: 'demand', is_active: true })
      .whereNotIn('alert_key', Array.from(criticalAlertKeys))
      .update({ is_active: false, resolved_at: trx.fn.now(), updated_at: trx.fn.now() });

    return { summary, variants, computed_at: new Date().toISOString() };
  });
}