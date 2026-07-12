// apps/backend/src/services/products-operator/ProductsDemandBridge.service.ts
//
// ProductsDemandBridge
// --------------------
// Cross-domain bridge: pulls demand intelligence signals into the
// products operator surface.
//
// DESIGN CONTRACT:
// - Read-only — never mutates demand state
// - Demand service owns its own transaction + RLS — no trx threading needed
// - Returns null if demand data is unavailable (growth tier not enabled,
//   no velocity data yet, or demand service error)
// - Caller (ProductsOperatorSummary.provider) handles null gracefully
// - Growth-tier gating is enforced at the API layer (requireTier middleware),
//   not here — this service is tier-agnostic

import { computeDemandIntelligence } from '../demand/demandIntelligence.service.js';
import type { DemandVelocity } from '../demand/demandIntelligence.service.js';

export type ProductsDemandSignals = {
  // Reorder pressure counts
  critical_reorder_count: number;
  warning_reorder_count: number;
  stockout_count: number;

  // Capital at risk — sum of unit_cost × available_qty for all tracked variants
  total_inventory_value: number;

  // Dead capital — variants with no velocity and stock on hand
  // unit_cost × available_quantity for no_velocity variants
  dead_capital_value: number;

  // Cross-domain combo signals
  // High velocity + low days of stock → reorder now
  reorder_now: Array<{
    lasyncro_variant_id: string;
    sku: string | null;
    title: string | null;
    product_title: string | null;
    days_of_stock_remaining: number | null;
    estimated_stockout_date: string | null;
    velocity_per_day: number;
    suggested_reorder_qty: number | null;
  }>;

  // Summary
  avg_days_of_stock: number | null;
};

export async function getProductsDemandSignals(
  shopId: number
): Promise<ProductsDemandSignals | null> {
  try {
    const result = await computeDemandIntelligence(shopId);

    const deadCapitalValue = result.variants
      .filter((v: DemandVelocity) => v.reorder_urgency === 'no_velocity' && v.available_quantity > 0)
      .reduce((sum: number, v: DemandVelocity) => {
        if (v.unit_cost == null) return sum;
        return sum + v.unit_cost * v.available_quantity;
      }, 0);

    // Reorder now = critical or warning urgency, sorted by days_of_stock ascending
    const reorderNow = result.variants
      .filter((v: DemandVelocity) =>
        v.reorder_urgency === 'critical' || v.reorder_urgency === 'warning'
      )
      .sort((a: DemandVelocity, b: DemandVelocity) => {
        const aD = a.days_of_stock_remaining ?? Infinity;
        const bD = b.days_of_stock_remaining ?? Infinity;
        return aD - bD;
      })
      .map((v: DemandVelocity) => ({
        lasyncro_variant_id: v.lasyncro_variant_id,
        sku: v.sku,
        title: v.title,
        product_title: v.product_title,
        days_of_stock_remaining: v.days_of_stock_remaining,
        estimated_stockout_date: v.estimated_stockout_date,
        velocity_per_day: v.velocity_per_day,
        suggested_reorder_qty: v.suggested_reorder_qty,
      }));

    return {
      critical_reorder_count: result.summary.critical_reorder_count,
      warning_reorder_count:  result.summary.warning_reorder_count,
      stockout_count:         result.summary.stockout_count,
      total_inventory_value:  result.summary.total_inventory_value,
      dead_capital_value:     deadCapitalValue,
      reorder_now:            reorderNow,
      avg_days_of_stock:      result.summary.avg_days_of_stock,
    };
  } catch {
    // Demand data unavailable — products module degrades gracefully
    return null;
  }
}