// apps/backend/src/api/suppliers/suppliers.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireRole } from '../../middleware/require-role.middleware.js';
import {
  httpGetSuppliers,
  httpCreateSupplier,
  httpGetPurchaseOrders,
  httpCreatePurchaseOrder,
  httpGetPoLineItems,
  httpUpdatePoStatus,
  httpReceiveShipment,
} from './suppliers.controller.js';

/**
 * SUPPLIERS PORTAL ROUTES
 * ------------------------
 * All routes require FT2 lifecycle and owner/admin role.
 * Operators do not manage suppliers or POs.
 *
 * Supplier rating recompute is triggered automatically
 * on PO status transition to received/partially_received.
 */
const router = Router();

// ── SUPPLIERS ──────────────────────────────────────────
router.get(
  '/',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpGetSuppliers
);

router.post(
  '/',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpCreateSupplier
);

// ── PURCHASE ORDERS ────────────────────────────────────
router.get(
  '/purchase-orders',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpGetPurchaseOrders
);

router.post(
  '/purchase-orders',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpCreatePurchaseOrder
);

router.get(
  '/purchase-orders/:poId/line-items',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpGetPoLineItems
);

router.patch(
  '/purchase-orders/:poId/status',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpUpdatePoStatus
);

router.post(
  '/purchase-orders/:poId/receive',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpReceiveShipment
);

export default router;