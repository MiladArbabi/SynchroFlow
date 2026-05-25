// apps/backend/src/api/orders/orders.routes.ts
import { Router } from 'express';
import * as ordersController from './orders.controller.js';
import { httpGetDailyOperationalBrief } from './orders.decision.controller.js';
import { httpGetPriorityStack } from './orders.priority.controller.js';
import { httpGetOperationalControl }
  from './orders.operational-control.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { httpGetOperationalPressure }
  from './orders.operational-pressure.controller.js';
import { httpGetConstrainedOrders }
  from './orders.constrained.controller.js';
import { httpGetFulfilledOrders }
  from './orders.fulfilled.controller.js';
import { httpGetOrderDecision }
  from './orders.decision-by-order.controller.js';
import { httpExecuteOrderDecision }
  from './orders.execute.controller.js';

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

/**
 * Operational Pressure (v0 contract)
 */
router.get(
  '/operational-pressure',
  authenticateToken,
  httpGetOperationalPressure
);

/**
 * Decision Engine Snapshots
 * -------------------------
 * These endpoints require authenticated tenant context because
 * controllers rely on req.user.shopId for strict tenant isolation.
 *
 * Missing authenticateToken would result in:
 * - req.user undefined
 * - 401 responses from controllers
 * - frontend refresh/login loops
 */
router.get(
  '/decision/operational-brief',
  authenticateToken,
  httpGetDailyOperationalBrief
);

router.get(
  '/decision/priority-stack',
  authenticateToken,
  httpGetPriorityStack
);

/**
 * FULFILLMENT QUEUE ENDPOINTS
 * ---------------------------
 * Power the Fulfillment Queue UI control surface.
 * All routes authenticated + tenant-scoped.
 */

/**
 * @route   GET /api/v1/orders/constrained
 * @desc    Paginated list of constrained orders grouped by type.
 * @access  Private
 */
router.get(
  '/constrained',
  authenticateToken,
  httpGetConstrainedOrders
);

/**
 * @route   GET /api/v1/orders/fulfilled
 * @desc    Shipped orders ledger for the Outbound tab.
 * @access  Private
 */
router.get(
  '/fulfilled',
  authenticateToken,
  httpGetFulfilledOrders
);

/**
 * @route   POST /api/v1/orders/:orderId/execute
 * @desc    Queue execution of recommended decision action for an order.
 * @access  Private
 */
router.post(
  '/:orderId/execute',
  authenticateToken,
  httpExecuteOrderDecision
);

/**
 * @route   GET /api/v1/orders/:orderId/decision
 * @desc    Current decision state for a single order.
 * @access  Private
 */
router.get(
  '/:orderId/decision',
  authenticateToken,
  httpGetOrderDecision
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