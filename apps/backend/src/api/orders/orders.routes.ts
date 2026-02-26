// apps/backend/src/api/orders/orders.routes.ts
import { Router } from 'express';
import * as ordersController from './orders.controller.js';
import { httpGetDailyOperationalBrief } from './orders.decision.controller.js';
import { httpGetPriorityStack } from './orders.priority.controller.js';

const router = Router();

/**
 * @route   GET /api/v1/orders
 * @desc    Get a list of all orders.
 * @access  Private
 */
router.get('/', ordersController.httpGetAllOrders);

/**
 * @route   GET /api/v1/orders/:id/status
 * @desc    Get the current fulfillment status of a single order.
 * @access  Private
 */
/* router.get('/:id/status', ordersController.httpGetOrderStatus); */

/**
 * @route   GET /api/v1/orders/:id/profitability
 * @desc    Get profitability metrics for a single order.
 * @access  Private
 */
router.get('/:id/profitability', ordersController.httpGetOrderProfitability);

/**
 * @route   GET /api/v1/orders/:id
 * @desc    Get consolidated details for a single order.
 * @access  Private
 */
router.get('/:id', ordersController.httpGetOrderDetails);

router.get(
  '/decision/operational-brief',
  httpGetDailyOperationalBrief
);

router.get(
  '/decision/priority-stack',
  httpGetPriorityStack
);

export default router;