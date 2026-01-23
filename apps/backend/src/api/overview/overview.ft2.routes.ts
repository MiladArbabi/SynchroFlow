// apps/backend/src/api/overview/overview.ft2.routes.ts
import { Router } from 'express';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { requireFt2 } from 'api-src/middleware/require-ft2.middleware';
import { getOverviewFt2 } from 'api-src/api/overview/overview.ft2.controller';

const router = Router();

/**
 * FT2 Overview (read-only)
 *
 * Orientation surface only.
 * No inference. No mutation.
 */
router.get('/ft2', authenticateToken, requireFt2, getOverviewFt2);

export default router;