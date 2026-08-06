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
   * INVENTORY CONSTRAINT — BIN + ROOT AWARE (SHOP-REV-02, Aug 2026)
   * --------------------------------------------------------------
   * History: originally hardcoded to WH-1-ROOT, which falsely blocked
   * variants stocked in bins (A-1, B-2). The May 2026 fix counted ONLY
   * bins — which inverted the bug: it falsely blocked variants whose
   * stock sits at the warehouse root. Neither version counted both.
   *
   * Root stock is real and sellable. seedShopifyOpeningBalances and
   * receiveJob both land stock at WH-{shopId}-ROOT as "available
   * (unlocated)"; nothing moves it to a bin until the merchant builds a
   * floor plan and stows. On a freshly installed tenant that is 100% of
   * inventory — so bin-only counting made every order oversell-blocked
   * and the order pool unreachable. Shopify review ref 102766.
   *
   * Now counts active bin AND warehouse-root locations. Lane and shelf
   * stay excluded — frame geometry, never holds stock.
   *
   * MUST stay in sync with batchReservation.service.ts's pickable-location
   * filter. That decides what is reservable; this decides what is
   * eligible. If they diverge, orders either block with stock on hand or
   * reach release and throw.
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
        .andOn(trx.raw('wl.type IN (?, ?)', ['bin', 'warehouse']));
    })
    .where('ru.lasyncro_order_id', orderId)
    .select(
      'ru.lasyncro_variant_id',
      trx.raw('SUM(ru.quantity - ru.fulfilled_quantity) as remaining_quantity'),
      /*
       * Sum available_quantity across all active bins.
       * COALESCE to 0 when no bin stock exists — triggers constraint.
       */
      trx.raw('COALESCE(SUM(it.available_quantity) FILTER (WHERE wl.type IN (?, ?)), 0) as available_quantity', ['bin', 'warehouse'])
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