import { Router } from 'express';

import { getOverviewFt2 } from './overview.ft2.controller.js';
import { getOverviewModulesFt2 } from './overview.modules-ft2.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';

const router = Router();

/**
 * STRICT Overview FT2
 * ------------------
 * Trust + completion gated
 */
router.get(
  '/ft2',
  authenticateToken,
  requireFt2,
  getOverviewFt2
);

/**
 * Overview Modules FT2
 * -------------------
 * Independent module visibility
 * NOT trust-gated
 * NOT completion-gated
 */
router.get(
  '/modules-ft2',
  authenticateToken,
  getOverviewModulesFt2
);

export default router;
