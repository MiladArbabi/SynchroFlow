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
import db from '@lasyncro/backend-core/db.js';

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
  const validOrders = await db('orders as o')
    .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .whereIn('o.lasyncro_order_id', order_ids)
    .whereNull('pbo.lasyncro_order_id')
    .select('o.lasyncro_order_id');

  const validIds = validOrders.map((r: any) => r.lasyncro_order_id);

  if (validIds.length === 0) {
    return res.status(404).json({ error: 'NO_VALID_ORDERS', flagged_count: 0 });
  }

  // Use SECURITY DEFINER function to bypass projection write guard
  let flaggedCount = 0;
  for (const orderId of validIds) {
    await db.raw('SELECT set_order_priority_flag(?, ?)', [orderId, true]);
    flaggedCount++;
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

  const validOrders = await db('orders')
    .where('shop_id', shopId)
    .whereIn('lasyncro_order_id', order_ids)
    .select('lasyncro_order_id');

  const validIds = validOrders.map((r: any) => r.lasyncro_order_id);

  for (const orderId of validIds) {
    await db.raw('SELECT set_order_priority_flag(?, ?)', [orderId, false]);
  }

  return res.json({ deprioritised_count: validIds.length });
}