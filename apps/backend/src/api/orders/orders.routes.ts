// apps/backend/src/api/orders/orders.routes.ts
import { Router } from 'express';
import * as ordersController from './orders.controller.js';
import { httpGetDailyOperationalBrief } from './orders.decision.controller.js';
import { httpGetPriorityStack } from './orders.priority.controller.js';
import { httpGetOperationalControl } 
  from './orders.operational-control.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

const router = Router();

/**
 * @route   GET /api/v1/orders
 * @desc    Get a list of all orders.
 * @access  Private
 */
router.get('/', ordersController.httpGetAllOrders);

/**
 * Operational Control Snapshot
 */
router.get(
  '/operational-control',
  authenticateToken,
  httpGetOperationalControl
);

router.get(
  '/decision/operational-brief',
  httpGetDailyOperationalBrief
);

router.get(
  '/decision/priority-stack',
  httpGetPriorityStack
);

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

export default router;