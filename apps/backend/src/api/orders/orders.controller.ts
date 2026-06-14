// apps/backend/src/api/orders/orders.controller.ts
import { Request, Response } from 'express';
import * as ordersService from './orders.service.js';
import { isValidTier } from '@lasyncro/backend-core/config/tiers.js';

/**
 * @route   GET /api/v1/orders
 * @desc    Get a list of all orders.
 * @access  Private
 */
export const httpGetAllOrders = async (req: Request, res: Response) => {
  try {

    /**
     * TENANT IDENTITY ENFORCEMENT
     * ---------------------------
     * Controllers must inject shopId into service layer.
     * Service layer must never infer tenant identity.
     */
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({
        error: 'Unauthorized: missing shop context',
      });
    }

    const rawTier = req.user?.tier ?? 'starter';
    const tier = isValidTier(rawTier) ? rawTier : 'starter';
    const orders = await ordersService.getAllOrders(shopId, tier);
    res.status(200).json(orders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch orders list: ${message}` });
  }
};

/**
 * @route   GET /api/v1/orders/:id/status
 * @desc    Get the current fulfillment status of a single order.
 * @access  Private
 */
/* export const httpGetOrderStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const status = await ordersService.getOrderStatusById(id);
    res.status(200).json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch order status for ${id}: ${message}` });
  }
}; */

/**
 * @route   GET /api/v1/orders/:id/profitability
 * @desc    Get profitability metrics for a single order.
 * @access  Private
 */
export const httpGetOrderProfitability = async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({
        error: 'Unauthorized: missing shop context',
      });
    }

    const profitability = await ordersService.getOrderProfitabilityById(
      shopId,
      id
    );
    res.status(200).json(profitability);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch order profitability for ${id}: ${message}` });
  }
};

/**
 * @route   GET /api/v1/orders/:id
 * @desc    Get consolidated details for a single order.
 * @access  Private
 */
export const httpGetOrderDetails = async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({
        error: 'Unauthorized: missing shop context',
      });
    }

    const details = await ordersService.getOrderDetailsById(
      shopId,
      id
    );
    if (details) {
      res.status(200).json(details);
    } else {
      res.status(404).json({ error: `Order with ID ${id} not found.` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch order details for ${id}: ${message}` });
  }
};