// apps/backend/src/api/cashflow/cashflow.routes.ts

import { Router } from 'express';
import { httpGetCashFlow } from './cashflow.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';

const router = Router();

/**
 * @route   GET /api/v1/modules/cashflow
 * @desc    Cash flow projection — summary, buckets, constraint breakdown
 * @access  Private — FT2
 */
router.get('/', authenticateToken, requireFt2, httpGetCashFlow);

export default router;