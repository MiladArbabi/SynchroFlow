// apps/backend/src/api/customers/customers.ltv.routes.ts
import { Router } from 'express';
import { httpGetCustomerLtv } from './customers.ltv.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';

const router = Router();

// Growth tier required — LTV is an intelligence module (MON-06)
router.get('/ltv', authenticateToken, requireFt2, requireTier('growth'), httpGetCustomerLtv);

export default router;