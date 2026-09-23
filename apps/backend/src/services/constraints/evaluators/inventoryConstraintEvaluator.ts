import { Knex } from 'knex';
import { ConstraintEvaluationResult } from '../constraint.types.js';
import {
  readReleaseCapacity,
  sumReleaseCapacityByVariant,
} from '../../inventory/releaseCapacity.service.js';

export async function evaluateInventoryConstraint(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number
): Promise<ConstraintEvaluationResult[]> {

  /**
   * SOURCE OF TRUTH: release capacity (GH-1145-A1)
   * ----------------------------------------------
   * Constraint must be derived from actual stock state, NOT from previously
   * projected constraints — and from the SAME quantity definition the
   * release precheck and the reservation lock use: readReleaseCapacity
   * (inventory_truth.available_quantity at canonical pickable locations).
   *
   * History (SHOP-REV-02 / FRESH-STOW-CLIFF-01): bins-only and root-only
   * counting each falsely blocked real stock. Pickable = active pick bins
   * AND warehouse root, unconditionally; lanes stay excluded. That
   * predicate now lives in one place behind readReleaseCapacity, so
   * eligibility and reservability cannot diverge (INV-BLOCK-19).
   *
   * shop_id scoping via RLS — SET LOCAL must be called by caller.
   */
  const demandRows: Array<{
    lasyncro_variant_id: string;
    remaining_quantity: number | string;
  }> = await trx('order_revenue_units')
    .where('lasyncro_order_id', orderId)
    .select(
      'lasyncro_variant_id',
      trx.raw(
        'SUM(quantity - fulfilled_quantity) as remaining_quantity'
      )
    )
    .groupBy('lasyncro_variant_id');

  const capacityByVariant = sumReleaseCapacityByVariant(
    await readReleaseCapacity(trx, {
      shopId,
      variantIds: demandRows
        .map((row) => row.lasyncro_variant_id)
        .filter((variantId): variantId is string => !!variantId),
      lock: 'none',
    })
  );

  const rows = demandRows.map((row) => ({
    lasyncro_variant_id: row.lasyncro_variant_id,
    remaining_quantity: row.remaining_quantity,
    available_quantity: capacityByVariant.get(row.lasyncro_variant_id) ?? 0,
  }));

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