// apps/backend/src/api/dashboard/dashboard.controller.ts
import { Request, Response } from 'express';
import db from '../../db';
import { requireShopIdForUser } from 'api-src/services/shop-resolution.service';

/**
 * Dashboard Controller
 * ====================
 * Read-only KPI & insight endpoints scoped strictly to the
 * authenticated user's shop.
 *
 * Invariants:
 * - shopId is resolved centrally via shop-resolution.service
 * - shopId is NEVER nullable inside handlers
 * - controllers never query `users` table
 */

export const getPulse = async (req: Request, res: Response) => {
  try {
    const shopId = await requireShopIdForUser(req.user!.userId);
    const today = new Date().toISOString().split('T')[0];

    const pulseData = await db('orders')
      .where({ shop_id: shopId })
      .where('created_at', '>=', today)
      .sum('total_price as totalRevenue')
      .count('id as orderCount')
      .first();

    const unfulfilled = await db('orders')
      .where({ shop_id: shopId })
      .whereNot('fulfillment_status', 'FULFILLED')
      .count('id as unfulfilledCount')
      .first();

    res.json({
      totalRevenue: Number(pulseData?.totalRevenue || 0),
      orderCount: Number(pulseData?.orderCount || 0),
      unfulfilledCount: Number(unfulfilled?.unfulfilledCount || 0),
    });
  } catch (err) {
    console.error('[dashboard] getPulse failed', err);
    res.status(500).json({ error: 'Failed to fetch pulse data.' });
  }
};

export const getInventoryHealth = async (req: Request, res: Response) => {
  try {
    const shopId = await requireShopIdForUser(req.user!.userId);

    const lowStockItems = await db('shopify_products')
      .where({ shop_id: shopId, status: 'ACTIVE' })
      .where('total_inventory', '<', 20)
      .orderBy('total_inventory', 'asc')
      .limit(5)
      .select('title', 'total_inventory', 'platform_product_id as id');

    res.json(lowStockItems);
  } catch (err) {
    console.error('[dashboard] getInventoryHealth failed', err);
    res.status(500).json({ error: 'Failed to fetch inventory health.' });
  }
};

export const getShipmentStatus = async (req: Request, res: Response) => {
  try {
    const shopId = await requireShopIdForUser(req.user!.userId);

    const recentUnfulfilled = await db('orders')
      .where({ shop_id: shopId })
      .whereNot('fulfillment_status', 'FULFILLED')
      .orderBy('created_at', 'desc')
      .limit(5)
      .select(
        'order_number',
        'created_at',
        'total_price',
        'platform_order_id as id'
      );

    res.json(recentUnfulfilled);
  } catch (err) {
    console.error('[dashboard] getShipmentStatus failed', err);
    res.status(500).json({ error: 'Failed to fetch shipment data.' });
  }
};

export const getCashTraps = async (req: Request, res: Response) => {
  try {
    const shopId = await requireShopIdForUser(req.user!.userId);

    const cashTraps = await db('shopify_products')
      .where({ shop_id: shopId, status: 'ACTIVE' })
      .andWhere('total_inventory', '>', 100)
      .orderBy('total_inventory', 'desc')
      .limit(5)
      .select(
        'title',
        'total_inventory',
        'platform_product_id as id',
        'variants'
      );

    res.json(
      cashTraps.map(p => ({
        ...p,
        variants: p.variants ? JSON.parse(p.variants) : [],
      }))
    );
  } catch (err) {
    console.error('[dashboard] getCashTraps failed', err);
    res.status(500).json({ error: 'Failed to fetch cash traps.' });
  }
};

export const getTopProducts = async (req: Request, res: Response) => {
  try {
    const shopId = await requireShopIdForUser(req.user!.userId);

    const topProducts = await db('order_line_items as oli')
      .join(
        'shopify_products as p',
        'oli.platform_product_id',
        'p.platform_product_id'
      )
      .where('oli.shop_id', shopId)
      .andWhere('p.status', 'ACTIVE')
      .select('p.title', 'p.platform_product_id as id')
      .sum('oli.quantity as totalSold')
      .groupBy('p.title', 'p.platform_product_id')
      .orderBy('totalSold', 'desc')
      .limit(5);

    res.json(topProducts);
  } catch (err) {
    console.error('[dashboard] getTopProducts failed', err);
    res.status(500).json({ error: 'Failed to fetch top products.' });
  }
};

export const getSalesByTrafficSource = async (req: Request, res: Response) => {
  try {
    const shopId = await requireShopIdForUser(req.user!.userId);

    const rows = await db('orders')
      .where({ shop_id: shopId })
      .whereNotNull('source_name')
      .select('source_name')
      .sum('total_price as totalRevenue')
      .count('id as orderCount')
      .groupBy('source_name')
      .orderBy('totalRevenue', 'desc')
      .limit(5);

    res.json(
      rows.map(r => ({
        source: r.source_name || 'Unknown',
        totalRevenue: Number(r.totalRevenue),
        orderCount: Number(r.orderCount),
      }))
    );
  } catch (err) {
    console.error('[dashboard] getSalesByTrafficSource failed', err);
    res.status(500).json({ error: 'Failed to fetch sales data.' });
  }
};