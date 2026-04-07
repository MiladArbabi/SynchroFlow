// apps/backend/src/api/returns/returns.routes.ts

import { Router } from 'express';
import { httpGetReturns } from './returns.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';

const router = Router();

/**
 * @route   GET /api/v1/modules/returns
 * @desc    Returns intelligence — summary + per-variant breakdown
 * @access  Private — FT2
 */
router.get('/', authenticateToken, requireFt2, httpGetReturns);

export default router;