// apps/backend/src/api/customers/customers.ltv.routes.ts

import { Router } from 'express';
import { httpGetCustomerLtv } from './customers.ltv.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';

const router = Router();

/**
 * @route   GET /api/v1/modules/customers/ltv
 * @desc    Customer LTV intelligence — summary + per-customer RFM
 * @access  Private — FT2
 */
router.get('/ltv', authenticateToken, requireFt2, httpGetCustomerLtv);

export default router;