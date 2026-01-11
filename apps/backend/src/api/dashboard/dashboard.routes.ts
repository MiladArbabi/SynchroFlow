// apps/backend/src/api/dashboard/dashboard.routes.ts
import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import { 
    getPulse, 
    getInventoryHealth, 
    getShipmentStatus, 
    getCashTraps,
    getTopProducts, 
    getSalesByTrafficSource,
} from './dashboard.controller';
import { getDashboardFt2Snapshot } from './dashboard.ft2.controller';

const router = Router();

// All dashboard routes are protected by the auth middleware

// GET /api/v1/dashboard/pulse
router.get('/pulse', authenticateToken, getPulse);

// GET /api/v1/dashboard/inventory-health
router.get('/inventory-health', authenticateToken, getInventoryHealth);

// GET /api/v1/dashboard/shipment-status
router.get('/shipment-status', authenticateToken, getShipmentStatus);

// GET /api/v1/dashboard/cash-traps
router.get('/cash-traps', authenticateToken, getCashTraps);

// Endpoint for "Top Products" widget
router.get('/top-products', authenticateToken, getTopProducts);

// Endpoint for "Sales by Traffic Source" widget
router.get('/sales-by-traffic-source', authenticateToken, getSalesByTrafficSource);

router.get('/ft2', authenticateToken, getDashboardFt2Snapshot);

export default router;