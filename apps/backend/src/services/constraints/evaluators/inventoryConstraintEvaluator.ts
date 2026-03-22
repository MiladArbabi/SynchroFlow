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
  const rows = await trx('order_revenue_units as ru')
  .leftJoin('inventory_truth as it', function () {
    this.on('ru.lasyncro_variant_id', '=', 'it.lasyncro_variant_id');
    /**
     * LOCATION BINDING (CRITICAL)
     * ----------------------------
     * Prevents cross-location contamination.
     * Assumes single default location until multi-location supported.
     */
    this.andOn('it.location_code', '=', trx.raw('?', ['WH-1-ROOT']));
   })
  .where('ru.lasyncro_order_id', orderId)
  .select(
    'ru.lasyncro_variant_id',

    /**
     * REMAINING DEMAND
     */
    trx.raw('SUM(ru.quantity - ru.fulfilled_quantity) as remaining_quantity'),

    /**
     * AVAILABLE STOCK
     */
    trx.raw('COALESCE(MAX(it.available_quantity), 0) as available_quantity')
  )
  .groupBy('ru.lasyncro_variant_id');

  /**
   * OVERSSELL DETECTION
   */
  const isOversell = rows.some(r =>
    Number(r.available_quantity) < Number(r.remaining_quantity)
  );

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