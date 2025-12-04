// apps/backend/src/api/dashboard/dashboard.controller.ts
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

/* Endpoint for the "Cash Traps" widget (Heroes vs. Zeroes - Zeroes part).*/
export const getCashTraps = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);
    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    const cashTraps = await db('shopify_products')
      .where({ 
        shop_id: shopId, 
        status: 'ACTIVE' 
      })
      .andWhere('total_inventory', '>', 100)
      .orderBy('total_inventory', 'desc')
      .limit(5)
      .select('title', 'total_inventory', 'platform_product_id as id', 'variants');

    // Parse variants JSON if they exist
    const cashTrapsWithParsedVariants = cashTraps.map(product => ({
      ...product,
      variants: product.variants ? JSON.parse(product.variants) : []
    }));

    res.json(cashTrapsWithParsedVariants);
  } catch (error) {
    console.error('[dashboard.controller] Error in getCashTraps:', error);
    res.status(500).json({ error: 'Failed to fetch cash trap data.' });
  }
};

/**
 * Endpoint for the "Top Selling Products" widget.
 */
export const getTopProducts = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);
    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    // This query joins line items with products
    // It groups by product, sums the quantity, and orders by the highest sum
    const topProducts = await db('order_line_items as oli')
      .join(
        'shopify_products as p',
        'oli.platform_product_id',
        'p.platform_product_id',
      )
      .where('oli.shop_id', shopId)
      .andWhere('p.status', 'ACTIVE') // Only count active products
      .select('p.title', 'p.platform_product_id as id')
      .sum('oli.quantity as totalSold')
      .groupBy('p.title', 'p.platform_product_id')
      .orderBy('totalSold', 'desc')
      .limit(5);

    res.json(topProducts);
  } catch (error) {
    console.error('[dashboard.controller] Error in getTopProducts:', error);
    res.status(500).json({ error: 'Failed to fetch top products data.' });
  }
};

export const getSalesByTrafficSource = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);
    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    // Group by source_name, sum total_price, and count orders
    const trafficSources = await db('orders')
      .where({ shop_id: shopId })
      .whereNotNull('source_name') // Only include orders with a source
      .select('source_name')
      .sum('total_price as totalRevenue')
      .count('id as orderCount')
      .groupBy('source_name')
      .orderBy('totalRevenue', 'desc')
      .limit(5); // Get top 5 sources

    // Clean up the data (Knex returns bigints/decimals as strings)
    const formattedSources = trafficSources.map((source) => ({
      source: source.source_name || 'Unknown',
      totalRevenue: parseFloat(String(source.totalRevenue)),
      orderCount: parseInt(String(source.orderCount), 10),
    }));

    res.json(formattedSources);
  } catch (error) {
    console.error(
      '[dashboard.controller] Error in getSalesByTrafficSource:',
      error,
    );
    res.status(500).json({ error: 'Failed to fetch traffic source data.' });
  }
};