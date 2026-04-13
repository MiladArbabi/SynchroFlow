// apps/backend/src/routes/overview.ts
import { Router } from 'express';
import { getOverviewFt2 } from '../api/overview/overview.ft2.controller.js';
import { getOverviewModulesFt2 } from '../api/overview/overview.modules-ft2.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

const router = Router();

/**
 * GET /api/v1/modules/overview
 * Trust-gated aggregate FT2 snapshot (orders + products + customers).
 * Returns 204 when trust gate not satisfied.
 */
router.get('/', authenticateToken, getOverviewFt2);

/**
 * GET /api/v1/modules/overview/modules-ft2
 * Ungated per-module FT2 visibility surface.
 * Independent of trust — always renders presence signals.
 */
router.get('/modules-ft2', authenticateToken, getOverviewModulesFt2);

export default router;