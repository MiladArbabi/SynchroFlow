// apps/backend/src/api/suppliers/suppliers.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireRole } from '../../middleware/require-role.middleware.js';
import { httpGetPurchaseOrders } from './suppliers.controller.js';

/**
 * SUPPLIERS PORTAL ROUTES
 * ------------------------
 * All routes require FT2 lifecycle and owner/admin role.
 * Operators do not have access to supplier management.
 *
 * FEAT-001: Extend with POST /purchase-orders, PATCH /:id, etc.
 * once purchase_orders schema migration is complete.
 */
const router = Router();

router.get(
  '/purchase-orders',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpGetPurchaseOrders
);

export default router;