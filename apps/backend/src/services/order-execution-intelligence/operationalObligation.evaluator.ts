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

import db from 'api-src/db';

export async function evaluateOperationalObligations(shopId: number) {
  // Mark blocked
  await db('order_fulfillment_status as ofs')
    .where('ofs.shop_id', shopId)
    .whereExists(function () {
      this.select(1)
        .from('operational_blocking_events as e')
        .whereRaw('e.canonical_order_id = ofs.canonical_order_id')
        .whereNull('e.resolved_at');
    })
    .update({
      has_operational_block: true,
      obligation_evaluated_at: db.fn.now(),
    });

  // Clear non-blocked
  await db('order_fulfillment_status')
    .where('shop_id', shopId)
    .whereNotExists(function () {
      this.select(1)
        .from('operational_blocking_events as e')
        .whereRaw('e.canonical_order_id = order_fulfillment_status.canonical_order_id')
        .whereNull('e.resolved_at');
    })
    .update({
      has_operational_block: false,
      obligation_evaluated_at: db.fn.now(),
    });
}
