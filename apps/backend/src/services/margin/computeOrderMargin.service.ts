// apps/backend/src/services/margin/computeOrderMargin.service.ts

import type { Knex } from 'knex';
import { debugLog } from '../../projection/projection.utils.js';

/**
 * MARGIN COMPUTATION SERVICE (MG-01, MG-02)
 * ------------------------------------------
 * Computes and persists per-order margin into order_margin_snapshot.
 *
 * Sources:
 * - order_revenue_units.line_total → gross_revenue
 * - order_revenue_units.quantity × estimated_unit_cost → estimated_cost
 * - gross_margin = gross_revenue - estimated_cost
 * - margin_pct = gross_margin / gross_revenue × 100
 *
 * RULES:
 * - Only computes orders with at least one estimated_unit_cost
 * - Idempotent — upserts on lasyncro_order_id
 * - Must run inside reconciliation transaction
 * - aggregate_version bound to calling reconciliation version
 *
 * Called by:
 * - reconciliation.handlers.ts after order projection
 */
export async function computeOrderMargin(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number,
  aggregateVersion: number
): Promise<void> {
  /**
   * AGGREGATE FROM order_revenue_units
   * -----------------------------------
   * Only include line items with cost data.
   * Orders with no cost data are skipped — no margin row.
   */
  // FIN-02 (2026-06-23): revenue completeness fix.
  // BUG: a row-level `estimated_unit_cost > 0` filter dropped cost-less
  // line items from ALL aggregates — so revenue was understated by any
  // line missing a cost (e.g. order c7bad89d: 2365.85 → 1479.90, losing
  // an 885.95 cost-less unit). Revenue and cost-coverage were conflated.
  //
  // FIX: revenue sums EVERY unit; cost sums ONLY cost-bearing units via
  // FILTER; cost_line_count drives the skip guard so genuinely cost-less
  // orders still produce no row. A cost-less line now correctly lowers
  // margin (full revenue, partial cost) instead of vanishing from revenue.
  const row = await trx('order_revenue_units')
    .where({ lasyncro_order_id: orderId })
    .select(
      trx.raw('SUM(line_total) as gross_revenue'),
      trx.raw('SUM(quantity * estimated_unit_cost) FILTER (WHERE estimated_unit_cost > 0) as estimated_cost'),
      trx.raw('COUNT(*) FILTER (WHERE estimated_unit_cost > 0) as cost_line_count')
    )
    .first();
  const lineCount = Number(row?.cost_line_count ?? 0);
  if (lineCount === 0) {
    /**
     * No cost data on ANY line — skip silently.
     * Expected for orders without variant cost information.
     */
    return;
  }

  const grossRevenue  = Number(row.gross_revenue ?? 0);
  const estimatedCost = Number(row.estimated_cost ?? 0);
  const grossMargin   = grossRevenue - estimatedCost;
  const marginPct     =
    grossRevenue > 0
      ? Math.round((grossMargin / grossRevenue) * 10000) / 10000
      : 0;

  // WM-39 — carrier shipping cost from order_shipment_tracking
  // Most recent label row for this order (latest shipment wins).
  // Nullable — orders without a generated label have null true_margin.
  const trackingRow = await trx('order_shipment_tracking')
    .where({ lasyncro_order_id: orderId })
    .orderBy('created_at', 'desc')
    .select('shipping_cost_excl_vat')
    .first();

  const carrierShippingCost = trackingRow?.shipping_cost_excl_vat != null
    ? Number(trackingRow.shipping_cost_excl_vat)
    : null;

  const trueMargin = carrierShippingCost != null
    ? grossMargin - carrierShippingCost
    : null;

  const trueMarginPct = trueMargin != null && grossRevenue > 0
    ? Math.round((trueMargin / grossRevenue) * 10000) / 10000
    : null;

  /**
   * UPSERT INTO order_margin_snapshot
   * -----------------------------------
   * Idempotent — safe to replay.
   * aggregate_version ensures deterministic versioning.
   */
  await trx('order_margin_snapshot')
    .insert({
      lasyncro_order_id:    orderId,
      shop_id:              shopId,
      aggregate_version:    aggregateVersion,
      gross_revenue:        grossRevenue,
      estimated_cost:       estimatedCost,
      gross_margin:         grossMargin,
      margin_pct:           marginPct,
      carrier_shipping_cost: carrierShippingCost,
      true_margin:          trueMargin,
      true_margin_pct:      trueMarginPct,
      evaluated_at:         trx.fn.now(),
    })
    .onConflict(['lasyncro_order_id'])
    .merge({
      aggregate_version:    aggregateVersion,
      gross_revenue:        grossRevenue,
      estimated_cost:       estimatedCost,
      gross_margin:         grossMargin,
      margin_pct:           marginPct,
      carrier_shipping_cost: carrierShippingCost,
      true_margin:          trueMargin,
      true_margin_pct:      trueMarginPct,
      evaluated_at:         trx.fn.now(),
      updated_at:           trx.fn.now(),
    });

  debugLog('[MARGIN_COMPUTED]', {
    orderId,
    grossRevenue,
    estimatedCost,
    grossMargin,
    marginPct,
    carrierShippingCost,
    trueMargin,
    trueMarginPct,
  });
}

/**
 * BULK MARGIN COMPUTATION
 * -----------------------
 * Computes margin for all orders in a shop with cost data.
 * Used for initial population and rebuild scenarios.
 */
export async function computeAllMarginsForShop(
  trx: Knex.Transaction,
  shopId: number
): Promise<{ computed: number; skipped: number }> {
  const orders = await trx('orders')
    .where({ shop_id: shopId })
    .select('lasyncro_order_id');

  let computed = 0;
  let skipped = 0;

  for (const order of orders) {
    /**
     * Use aggregate_version = 1 for bulk rebuild.
     * Reconciliation will overwrite with correct version on next cycle.
     */
    const before = computed;
    await computeOrderMargin(trx, order.lasyncro_order_id, shopId, 1);
    if (computed === before) skipped++;
    else computed++;
  }

  console.info('[MARGIN_BULK_COMPUTED]', { shopId, computed, skipped });
  return { computed, skipped };
}