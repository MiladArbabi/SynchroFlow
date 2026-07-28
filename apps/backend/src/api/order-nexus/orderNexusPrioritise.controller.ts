// apps/backend/src/api/order-nexus/orderNexusPrioritise.controller.ts
//
// ORDER PRIORITISE CONTROLLER (ON-01)
// ------------------------------------
// Sets is_priority_flagged on order_fulfillment_status for given order IDs.
// Uses set_order_priority_flag() SQL function to bypass projection write guard.
//
// RULES:
// - Owner/admin only (requireAction gated in routes)
// - Max 50 orders per request — prevents abuse
// - Non-existent order IDs are silently ignored (idempotent)
// - Returns count of orders actually flagged

import { Request, Response } from 'express';
import { withTenant } from '@lasyncro/backend-core/db.js';

const MAX_ORDERS_PER_REQUEST = 50;

export async function httpPrioritiseOrders(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { order_ids } = req.body as { order_ids?: string[] };

  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'order_ids must be a non-empty array' });
  }

  if (order_ids.length > MAX_ORDERS_PER_REQUEST) {
    return res.status(400).json({
      error: 'TOO_MANY_ORDERS',
      message: `Maximum ${MAX_ORDERS_PER_REQUEST} orders per request`,
    });
  }

  // THREAD B (2026-06-30): pool-membership guard added — ported from
  // the WMS singular endpoint (httpSetOrderPriority, wms.controller.ts),
  // which this bulk endpoint is replacing. Orders already in an active
  // pick batch must not be flagged — left join + whereNull excludes them,
  // matching the singular endpoint's exact semantics.
  // OV-21: `orders` and `pick_batch_orders` both have FORCE ROW LEVEL SECURITY
  // with qual shop_id = current_setting('app.current_tenant')::integer. A bare
  // db(...) connection never sets that GUC, so the policy evaluated against an
  // unset setting and this guard returned zero rows for EVERY input — not just
  // batched orders. The endpoint then fell through to its own NO_VALID_ORDERS
  // 404, making Prioritize dead on all four surfaces that call it. withTenant
  // opens a transaction with SET LOCAL app.current_tenant, the same pattern
  // OrdersOperatorFacts.service.ts and wms.controller.ts already use.
  const { validIds, flaggedCount } = await withTenant(shopId, async (trx) => {
    const validOrders = await trx('orders as o')
      .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .whereIn('o.lasyncro_order_id', order_ids)
      .whereNull('pbo.lasyncro_order_id')
      .select('o.lasyncro_order_id');

    const ids = validOrders.map((r: any) => r.lasyncro_order_id);
    if (ids.length === 0) return { validIds: ids, flaggedCount: 0 };

    // set_order_priority_flag is SECURITY DEFINER (pg_proc.prosecdef = t) so it
    // bypasses the projection write guard. Running it on trx keeps the guard
    // read and the writes in one atomic transaction — previously the read and
    // each write ran on separate connections.
    let count = 0;
    for (const orderId of ids) {
      await trx.raw('SELECT set_order_priority_flag(?, ?)', [orderId, true]);
      count++;
    }
    return { validIds: ids, flaggedCount: count };
  });

  if (validIds.length === 0) {
    return res.status(404).json({ error: 'NO_VALID_ORDERS', flagged_count: 0 });
  }

  return res.json({
    flagged_count: flaggedCount,
    requested_count: order_ids.length,
    skipped_count: order_ids.length - validIds.length,
  });
}

export async function httpDeprioritiseOrders(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { order_ids } = req.body as { order_ids?: string[] };

  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'order_ids must be a non-empty array' });
  }

  // OV-21: identical RLS gap to httpPrioritiseOrders above — same tables, same
  // forced policy, same silent zero-row result. Fixed in the same pass since it
  // is the same defect in the same file, not a batched unrelated change.
  const deprioritisedCount = await withTenant(shopId, async (trx) => {
    const validOrders = await trx('orders')
      .where('shop_id', shopId)
      .whereIn('lasyncro_order_id', order_ids)
      .select('lasyncro_order_id');

    const ids = validOrders.map((r: any) => r.lasyncro_order_id);
    for (const orderId of ids) {
      await trx.raw('SELECT set_order_priority_flag(?, ?)', [orderId, false]);
    }
    return ids.length;
  });

  return res.json({ deprioritised_count: deprioritisedCount });
}