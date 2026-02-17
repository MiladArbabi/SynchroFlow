/**
 * Operational Obligation v1 — Deterministic
 * ----------------------------------------
 * Truth source:
 * - operational_blocking_events
 *
 * Rules:
 * - Event-backed only
 * - No inference
 * - true  = unresolved blocking event exists
 * - false = explicitly cleared
 */

import db from '@lasyncro/backend-core/db.js';

/**
 * SOVEREIGN OPERATIONAL OBLIGATION ANCHOR (v2)
 * -------------------------------------------
 * - UUID-anchored via lasyncro_order_id
 * - shop_id derived from orders
 * - Blocking truth uses is_active boolean
 */
export async function evaluateOperationalObligations(shopId: number) {
  // Mark blocked
  await db('order_fulfillment_status as ofs')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .whereExists(function () {
      this.select(1)
        .from('operational_blocking_events as e')
        .whereRaw('e.lasyncro_order_id = ofs.lasyncro_order_id')
        .where('e.is_active', true);
    })
    .update({
      has_operational_block: true,
      obligation_evaluated_at: db.fn.now(),
    });

  // Clear non-blocked
  await db('order_fulfillment_status as ofs')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .whereNotExists(function () {
      this.select(1)
        .from('operational_blocking_events as e')
        .whereRaw('e.lasyncro_order_id = ofs.lasyncro_order_id')
        .where('e.is_active', true);
    })
    .update({
      has_operational_block: false,
      obligation_evaluated_at: db.fn.now(),
    });
}