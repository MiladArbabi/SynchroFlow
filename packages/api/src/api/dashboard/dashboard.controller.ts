// packages/api/src/api/dashboard/dashboard.controller.ts
import { Request, Response } from 'express';
import db from '../../db';
import { User } from 'api-types'; // Assuming this type exists

/**
 * Helper function to get the shop_id from an authenticated user.
 */
const getShopIdFromRequest = async (req: Request): Promise<number | null> => {
  if (!req.user) return null;
  const userId = req.user.userId;
  
  // We need the user's shop_id to query data
  const user = await db<User>('users').where({ id: userId }).first('shop_id');
  
  return user?.shop_id || null;
};

/**
 * Endpoint for the "Pulse" (KPIs) widget.
 */
export const getPulse = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);
    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    const today = new Date().toISOString().split('T')[0];

    const pulseData = await db('orders')
      .where({ shop_id: shopId })
      .where('created_at', '>=', today)
      .sum('total_price as totalRevenue')
      .count('id as orderCount')
      .first();

    const unfulfilled = await db('orders')
      .where({ shop_id: shopId })
      .whereNot('fulfillment_status', 'FULFILLED') // Assumes 'FULFILLED' is the final state
      .count('id as unfulfilledCount')
      .first();

    res.json({
      totalRevenue: parseFloat(String(pulseData?.totalRevenue || 0)),
      orderCount: parseInt(String(pulseData?.orderCount || 0), 10),
      unfulfilledCount: parseInt(String(unfulfilled?.unfulfilledCount || 0), 10),
    });
  } catch (error) {
    console.error('[dashboard.controller] Error in getPulse:', error);
    res.status(500).json({ error: 'Failed to fetch pulse data.' });
  }
};

/**
 * Endpoint for the "Inventory Health" widget.
 */
export const getInventoryHealth = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);
    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    const lowStockItems = await db('shopify_products')
      .where({ shop_id: shopId, status: 'ACTIVE' }) // Only active products
      .where('total_inventory', '<', 20) // Define "low stock" as < 20
      .orderBy('total_inventory', 'asc')
      .limit(5)
      .select('title', 'total_inventory', 'platform_product_id as id');

    res.json(lowStockItems);
  } catch (error) {
    console.error('[dashboard.controller] Error in getInventoryHealth:', error);
    res.status(500).json({ error: 'Failed to fetch inventory data.' });
  }
};

/**
 * Endpoint for the "Shipment Status" widget.
 */
export const getShipmentStatus = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);
    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    const recentUnfulfilled = await db('orders')
      .where({ shop_id: shopId })
      .whereNot('fulfillment_status', 'FULFILLED')
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('order_number', 'created_at', 'total_price', 'platform_order_id as id');

    res.json(recentUnfulfilled);
  } catch (error) {
    console.error('[dashboard.controller] Error in getShipmentStatus:', error);
    res.status(500).json({ error: 'Failed to fetch shipment data.' });
  }
};