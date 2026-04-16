// apps/backend/src/api/suppliers/suppliers.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * SUPPLIERS PORTAL CONTROLLERS
 * -----------------------------
 * All queries are tenant-scoped via req.user.shopId + RLS current_tenant.
 *
 * Currently returns stub data — real schema (purchase_orders, suppliers tables)
 * to be added in FEAT-001 migration sprint.
 */

/**
 * GET /api/v1/suppliers/purchase-orders
 * Returns all purchase orders for the shop with supplier info and ETA.
 */
export async function httpGetPurchaseOrders(req: Request, res: Response) {

const shopId = req.user?.shopId;
if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // FEAT-001: Replace with real DB query once purchase_orders table exists.
    // Example query shape:
    // const orders = await db('purchase_orders')
    //   .join('suppliers', 'purchase_orders.supplier_id', 'suppliers.id')
    //   .where('purchase_orders.shop_id', shopId)
    //   .orderBy('purchase_orders.created_at', 'desc')
    //   .select(
    //     'purchase_orders.*',
    //     'suppliers.name as supplier_name',
    //     'suppliers.rating as supplier_rating'
    //   );

    return res.json({ purchase_orders: [] });
  } catch (err) {
    console.error('[suppliers] httpGetPurchaseOrders failed', err);
    return res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
}