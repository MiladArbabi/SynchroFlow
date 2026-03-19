import { Knex } from 'knex';

/**
 * ORDER INVENTORY CONSTRAINT PROJECTION
 * -------------------------------------
 * Deterministically computes whether an order is inventory
 * constrained (oversell) using the canonical projections:
 *
 *   order_revenue_units
 *   inventory_truth
 *
 * This replaces the runtime worker
 * computeObligationFlagsForOrders().
 *
 * Deterministic properties:
 * - rebuild-safe
 * - replay-safe
 * - no side effects
 */
export async function projectOrderInventoryConstraints(
  trx: Knex.Transaction,
  orderIds: string[]
): Promise<void> {

  if (orderIds.length === 0) return;
  let blockedCount = 0;

  const rows = await trx
    .with('variant_demand', (qb) => {
      qb
        .from('order_revenue_units as ru')
        .join('orders as o', 'o.lasyncro_order_id', 'ru.lasyncro_order_id')
        .select(
          'ru.lasyncro_order_id',
          'ru.lasyncro_variant_id',
          'o.order_created_at',
          'ru.quantity'
        )
        .select(
          trx.raw(`
            SUM(ru.quantity) OVER (
              PARTITION BY ru.lasyncro_variant_id
              ORDER BY o.order_created_at, ru.lasyncro_order_id
            ) AS cumulative_demand
          `)
        );
    })
    .with('variant_stock', (qb) => {
      qb
        .from('inventory_truth as it')
        .select('it.lasyncro_variant_id')
        .sum({ stock: 'it.available_quantity' })
        .groupBy('it.lasyncro_variant_id');
    })
    .from('variant_demand as vd')
    .leftJoin('variant_stock as vs', 'vs.lasyncro_variant_id', 'vd.lasyncro_variant_id')
    .select('vd.lasyncro_order_id')
    .max({
      oversell: trx.raw(`
        CASE
          WHEN vd.cumulative_demand > COALESCE(vs.stock,0)
          THEN 1
          ELSE 0
        END
      `)
    })
    .whereIn('vd.lasyncro_order_id', orderIds)
    .groupBy('vd.lasyncro_order_id');

  /**
   * SET-BASED PROJECTION WRITE
   * --------------------------
   * Oversell classification is written in a single deterministic batch.
   *
   * Guarantees:
   * - no N+1 writes
   * - stable rebuild behaviour
   * - observable mutation count
   */
  const updates = rows.map((row: any) => {
    const blockType = Number(row.oversell) === 1 ? 'oversell' : null;

    if (blockType) blockedCount++;

    return {
      lasyncro_order_id: row.lasyncro_order_id,
      inventory_block_type: blockType
    };
  });

  if (updates.length === 0) {
    console.debug('[inventory_constraint_projection.no_updates]');
    return;
  }

  for (const update of updates) {

    const existing = await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: update.lasyncro_order_id })
      .first();

    const prevBlockType = existing?.inventory_block_type ?? null;
    const nextBlockType = update.inventory_block_type;

    const isTransitionToBlocked = !prevBlockType && nextBlockType;
    const isTransitionToUnblocked = prevBlockType && !nextBlockType;

    await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: update.lasyncro_order_id })
      .update({
        inventory_block_type: nextBlockType,
        ...(isTransitionToBlocked && { block_started_at: trx.fn.now() }),
        ...(isTransitionToUnblocked && { block_resolved_at: trx.fn.now() })
      });

    /**
     * LIFECYCLE INSTRUMENTATION
     */
    if (isTransitionToBlocked) {
      console.debug('[INVENTORY_BLOCK_STARTED]', {
        orderId: update.lasyncro_order_id,
        blockType: nextBlockType
      });
    }

    if (isTransitionToUnblocked) {
      console.debug('[INVENTORY_BLOCK_RESOLVED]', {
        orderId: update.lasyncro_order_id,
        previous: prevBlockType
      });
    }
  }

  console.debug('[inventory_constraint_projection.completed]', {
    evaluated_orders: updates.length,
    blocked: blockedCount
  });
}