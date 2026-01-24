import { Router } from 'express';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { requireFt2 } from 'api-src/middleware/require-ft2.middleware';

import { getOverviewFt2 } from './overview.ft2.controller';
import { getOverviewModulesFt2 } from './overview.modules-ft2.controller';

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
