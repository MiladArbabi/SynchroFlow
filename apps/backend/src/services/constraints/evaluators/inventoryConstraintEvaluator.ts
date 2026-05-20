import { Knex } from 'knex';
import { ConstraintEvaluationResult } from '../constraint.types.js';

export async function evaluateInventoryConstraint(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number
): Promise<ConstraintEvaluationResult[]> {

  /**
   * SOURCE OF TRUTH: inventory_truth
   * --------------------------------
   * Constraint must be derived from actual stock state,
   * NOT from previously projected constraints.
   */
  /*
   * INVENTORY CONSTRAINT — MULTI-BIN AWARE (fixed May 2026)
   * --------------------------------------------------------
   * Previously hardcoded to WH-1-ROOT which caused false inventory
   * blocks for variants stocked in specific bins (A-1, B-2, etc).
   *
   * Now aggregates available_quantity across ALL active bin locations
   * for the shop. Frame zones (warehouse/lane/shelf) are excluded —
   * only bin-type locations hold pickable stock.
   *
   * shop_id scoping via RLS — SET LOCAL must be called by caller.
   */
  const rows = await trx('order_revenue_units as ru')
    .leftJoin('inventory_truth as it', function () {
      this.on('ru.lasyncro_variant_id', '=', 'it.lasyncro_variant_id')
          .andOn('it.shop_id', '=', trx.raw('?', [shopId]));
    })
    .leftJoin('warehouse_locations as wl', function () {
      this.on('wl.location_code', '=', 'it.location_code')
          .andOn('wl.shop_id', '=', trx.raw('?', [shopId]))
          .andOnVal('wl.active', true)
          .andOnVal('wl.type', 'bin');
    })
    .where('ru.lasyncro_order_id', orderId)
    .select(
      'ru.lasyncro_variant_id',
      trx.raw('SUM(ru.quantity - ru.fulfilled_quantity) as remaining_quantity'),
      /*
       * Sum available_quantity across all active bins.
       * COALESCE to 0 when no bin stock exists — triggers constraint.
       */
      trx.raw('COALESCE(SUM(it.available_quantity) FILTER (WHERE wl.type = ?), 0) as available_quantity', ['bin'])
    )
    .groupBy('ru.lasyncro_variant_id');

    /* isOversell derived per-variant below — no aggregate needed */

  /**
   * VARIANT-SCOPED CONSTRAINT EMISSION
   * ----------------------------------
   * Each variant must independently express constraint state.
   */
  const results: ConstraintEvaluationResult[] = [];

  for (const row of rows) {
    const remaining = Number(row.remaining_quantity);
    const available = Number(row.available_quantity);

    const isActive = available < remaining;

    results.push({
      type: 'inventory',
      isActive,
      targetId: row.lasyncro_variant_id,
      meta: {
        blockType: isActive ? 'oversell' : null
      }
    });
  }

  return results;
}