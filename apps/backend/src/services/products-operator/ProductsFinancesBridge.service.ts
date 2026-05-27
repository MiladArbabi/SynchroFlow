// apps/backend/src/services/products-operator/ProductsFinancesBridge.service.ts
//
// ProductsFinancesBridge
// ----------------------
// Cross-domain bridge: computes margin-at-risk for stocked-out variants
// and cost coverage gaps, surfaced in the products operator Intelligence tab.
//
// DESIGN CONTRACT:
// - Read-only — never mutates financial state
// - Returns null on failure — caller degrades gracefully
// - margin_at_risk_per_week: sum of (margin_per_unit × weekly_velocity) for
//   stocked-out variants with known unit_cost and recent sales
// - Uses variants.unit_cost (authoritative) not oru.estimated_unit_cost (snapshot)
// - Weekly velocity = (units_sold_30d / 30) × 7
// - Only variants with available_quantity <= 0 AND unit_cost > 0 AND units_sold > 0
//   contribute to margin_at_risk — no cost = unknown, no sales = no velocity loss
//
// SCHEMA FACTS (verified 2026-05-27):
// - order_revenue_units: unit_price (sale price), quantity, lasyncro_variant_id
// - variants: unit_cost numeric(12,2) — authoritative cost column
// - inventory_truth: available_quantity

import { withTenant } from '@lasyncro/backend-core/db.js';

export type StockedOutMarginVariant = {
  lasyncro_variant_id: string;
  sku: string | null;
  avg_sale_price: number;
  unit_cost: number;
  margin_per_unit: number;
  margin_pct: number;
  units_sold_30d: number;
  /** Estimated margin lost per week at current velocity */
  margin_lost_per_week: number;
};

export type ProductsFinancesSignals = {
  /** Total weekly margin loss from stocked-out variants with known cost + velocity */
  total_margin_at_risk_per_week: number;
  /** Count of active sellers (units_sold > 0) with no cost entered */
  active_sellers_no_cost: number;
  /** Per-variant breakdown — sorted by margin_lost_per_week desc */
  stocked_out_margin_variants: StockedOutMarginVariant[];
};

export async function getProductsFinancesSignals(
  shopId: number
): Promise<ProductsFinancesSignals | null> {
  try {
    return await withTenant(shopId, async (trx) => {

      // ── Margin at risk: stocked-out variants with cost + recent sales ─────
      const marginRows = await trx('order_revenue_units as oru')
        .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
        .join('variants as v', 'v.lasyncro_variant_id', 'oru.lasyncro_variant_id')
        .join('inventory_truth as it', 'it.lasyncro_variant_id', 'oru.lasyncro_variant_id')
        .where('o.shop_id', shopId)
        .where('it.available_quantity', '<=', 0)
        .where('v.unit_cost', '>', 0)
        .where('oru.created_at', '>=', trx.raw("NOW() - INTERVAL '30 days'"))
        .groupBy('oru.lasyncro_variant_id', 'v.sku', 'v.unit_cost')
        .havingRaw('SUM(oru.quantity) > 0')
        .select([
          'oru.lasyncro_variant_id',
          'v.sku',
          'v.unit_cost',
          trx.raw('ROUND(AVG(oru.unit_price), 2) AS avg_sale_price'),
          trx.raw('ROUND(AVG(oru.unit_price) - v.unit_cost, 2) AS margin_per_unit'),
          trx.raw(`ROUND(
            ((AVG(oru.unit_price) - v.unit_cost) / NULLIF(AVG(oru.unit_price), 0)) * 100,
            1
          ) AS margin_pct`),
          trx.raw('SUM(oru.quantity)::integer AS units_sold_30d'),
          trx.raw(`ROUND(
            (AVG(oru.unit_price) - v.unit_cost) * (SUM(oru.quantity)::numeric / 30) * 7,
            2
          ) AS margin_lost_per_week`),
        ])
        .orderBy('margin_lost_per_week', 'desc');

      const stocked_out_margin_variants: StockedOutMarginVariant[] = marginRows.map(
        (r: any) => ({
          lasyncro_variant_id: r.lasyncro_variant_id,
          sku: r.sku,
          avg_sale_price: Number(r.avg_sale_price),
          unit_cost: Number(r.unit_cost),
          margin_per_unit: Number(r.margin_per_unit),
          margin_pct: Number(r.margin_pct),
          units_sold_30d: Number(r.units_sold_30d),
          margin_lost_per_week: Number(r.margin_lost_per_week),
        })
      );

      const total_margin_at_risk_per_week = stocked_out_margin_variants.reduce(
        (sum, v) => sum + v.margin_lost_per_week,
        0
      );

      // ── Active sellers with no cost entered ──────────────────────────────
      // "Active seller" = sold at least 1 unit in last 30 days AND unit_cost = 0
      const [noCostRow] = await trx('order_revenue_units as oru')
        .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
        .join('variants as v', 'v.lasyncro_variant_id', 'oru.lasyncro_variant_id')
        .where('o.shop_id', shopId)
        .where('v.unit_cost', 0)
        .where('oru.created_at', '>=', trx.raw("NOW() - INTERVAL '30 days'"))
        .countDistinct('oru.lasyncro_variant_id as count');

      const active_sellers_no_cost = Number(noCostRow.count);

      return {
        total_margin_at_risk_per_week: Math.round(total_margin_at_risk_per_week * 100) / 100,
        active_sellers_no_cost,
        stocked_out_margin_variants,
      };
    });
  } catch {
    // Finance data unavailable — products module degrades gracefully
    return null;
  }
}