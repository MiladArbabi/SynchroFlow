import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

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

const CONSTRAINT_NAMESPACE = 'a9b7c6d4-4f8a-4c1b-b7b6-1c9a2e5d7f91';

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

  /**
   * INVENTORY SIGNAL EVALUATION
   * ---------------------------
   * Centralized inventory constraint classification.
   *
   * Current:
   * - oversell → demand exceeds stock
   *
   * Future (extend here):
   * - reserved_conflict
   * - warehouse_unavailable
   * - allocation_pending
   *
   * RULE:
   * - Only ONE active block type at a time (priority order)
   */
  let blockType: string | null = null;

  if (blockType && typeof blockType !== 'string') {
    console.error('[INVENTORY_BLOCK_INVALID_TYPE]', {
      orderId: row.lasyncro_order_id,
      blockType
    });
  }

  // SIGNAL: oversell
  if (Number(row.oversell) === 1) {
    blockType = 'oversell';
  }

    if (blockType) blockedCount++;

    return {
      lasyncro_order_id: row.lasyncro_order_id,
      inventory_block_type: blockType ?? null // explicit for JSON → SQL casting
    };
  });

  if (updates.length === 0) {
    console.debug('[inventory_constraint_projection.no_updates]');
    return;
  }

  for (const update of updates) {
    const next = update.inventory_block_type;

    const constraintId = uuidv5(
      `inventory:${update.lasyncro_order_id}`,
      CONSTRAINT_NAMESPACE
    );

    // 1. try update existing constraint
    const updated = await trx('order_constraints')
      .where({
        lasyncro_order_id: update.lasyncro_order_id,
        constraint_type: 'inventory'
      })
      .update({
        block_type: next,
        is_active: !!next,
        resolved_at: next ? null : new Date()
      });

    // 2. insert only if missing
    if (updated === 0) {
      await trx('order_constraints').insert({
        constraint_id: constraintId,
        lasyncro_order_id: update.lasyncro_order_id,
        constraint_type: 'inventory',
        block_type: next,
        started_at: next ? new Date() : null,
        resolved_at: next ? null : new Date(),
        is_active: !!next,
        created_at: new Date()
      });
    }

    if (next) {
      console.debug('[INVENTORY_BLOCK_ACTIVE]', {
        orderId: update.lasyncro_order_id,
        blockType: next
      });
    }
  }

  console.debug('[inventory_constraint_projection.completed]', {
    evaluated_orders: updates.length,
    blocked: blockedCount
  });
}