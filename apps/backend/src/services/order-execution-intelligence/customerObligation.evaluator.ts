/**
 * Customer Obligation v4 — Deterministic
 * -------------------------------------
 * Truth source:
 * - customer_blocking_events
 *
 * Rules:
 * - Event-backed only
 * - No inference
 * - NULL = not evaluated
 * - true  = unresolved blocking event exists
 * - false = explicitly cleared
 */

import db from 'api-src/db';

/**
 * SOVEREIGN OBLIGATION ANCHOR (v2)
 * --------------------------------
 * - UUID-anchored via lasyncro_order_id
 * - shop_id derived from orders
 * - Blocking truth uses is_active boolean
 */
export async function evaluateCustomerObligations(shopId: number) {
  // Mark blocked orders
  await db('order_fulfillment_status as ofs')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .whereExists(function () {
      this.select(1)
        .from('customer_blocking_events as e')
        .whereRaw('e.lasyncro_order_id = ofs.lasyncro_order_id')
        .where('e.is_active', true);
    })
    .update({
      has_customer_block: true,
      customer_block_evaluated_at: db.fn.now(),
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
        .from('customer_blocking_events as e')
        .whereRaw('e.lasyncro_order_id = ofs.lasyncro_order_id')
        .where('e.is_active', true);
    })
    .update({
      has_customer_block: false,
      customer_block_evaluated_at: db.fn.now(),
    });
}