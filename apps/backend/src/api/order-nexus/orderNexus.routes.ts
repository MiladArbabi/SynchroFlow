// apps/backend/src/api/order-nexus/orderNexus.routes.ts

import { Router } from 'express';
import { orderNexusFt2Controller } from './orderNexusFt2.controller';

const router = Router();

/**
 * Order-Nexus FT2 Routes
 * ---------------------
 * Read-only FT2 truth surface.
 *
 * Final path:
 *   GET /api/v1/modules/order-nexus/ft2
 */
router.get('/ft2', orderNexusFt2Controller);

export default router;