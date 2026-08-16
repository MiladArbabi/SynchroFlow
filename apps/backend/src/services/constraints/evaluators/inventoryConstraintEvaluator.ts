import { Knex } from 'knex';
import { ConstraintEvaluationResult } from '../constraint.types.js';
import {
  pickableLocationCondition,
} from '../../inventory/pickableLocation.js';

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
   * FRESH-STOW-CLIFF-01: counts active pick bins AND warehouse root,
   * unconditionally — root holds real unstowed stock. See
   * pickableLocation.ts for why the bin-existence conditional was removed.
   * Lanes stay excluded: zone_type='pick' but type='lane', frame
   * geometry that never holds stock.
   *
   * MUST stay in sync with batchReservation.service.ts's pickable-location
   * filter. That decides what is reservable; this decides what is
   * eligible. If they diverge, orders either block with stock on hand or
   * reach release and throw.
   *
   * shop_id scoping via RLS — SET LOCAL must be called by caller.
   */
  const demandByVariant = trx('order_revenue_units')
    .where('lasyncro_order_id', orderId)
    .select(
      'lasyncro_variant_id',
      trx.raw(
        'SUM(quantity - fulfilled_quantity) as remaining_quantity'
      )
    )
    .groupBy('lasyncro_variant_id')
    .as('demand');

  const rows = await trx
    .from(demandByVariant)
    .leftJoin('inventory_truth as it', function () {
      this.on(
        'demand.lasyncro_variant_id',
        '=',
        'it.lasyncro_variant_id'
      ).andOn('it.shop_id', '=', trx.raw('?', [shopId]));
    })
    .leftJoin('warehouse_locations as wl', function () {
      this.on('wl.location_code', '=', 'it.location_code')
        .andOn('wl.shop_id', '=', trx.raw('?', [shopId]))
        .andOnVal('wl.active', true)
        .andOn(pickableLocationCondition(trx));
    })
    .select(
      'demand.lasyncro_variant_id',
      'demand.remaining_quantity',
      /**
       * Sum availability across matched pickable locations only. The
       * leftJoin already applies the canonical predicate, so a non-null
       * wl row IS a pickable row — filtering on the predicate again
       * would be a second definition free to drift (INV-BLOCK-19).
       * Demand is already one row per variant, so joining
       * location-level inventory cannot multiply required quantity.
       */
      trx.raw(
        'COALESCE(SUM(it.available_quantity) FILTER (WHERE wl.location_code IS NOT NULL), 0) as available_quantity'
      )
    )
    .groupBy(
      'demand.lasyncro_variant_id',
      'demand.remaining_quantity'
    );

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