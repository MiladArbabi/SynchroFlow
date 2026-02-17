// apps/backend/src/api/specter/specter.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import {
  getSpecterState,
  getSpecterConfig,
  upsertSpecterConfig
} from './specter.controller.js';
import { httpGetSpecterFt2 } from './specter.ft2.controller.js';

const router = Router();

// GET /api/v1/specter/:shopId/state
// Protected: requires authentication so we can resolve the user's shop.
/** 
 * GET /api/v1/specter/:shopId/state
 * Allows explicit shopId param (admin / internal use).
 * Auth required; controller will fallback to authenticated user if shopId is missing.
 */
router.get('/:shopId/state', authenticateToken, getSpecterState);

/**
 * GET /api/v1/specter/state
 * Alias: resolves shopId ONLY from authenticated user.
 */
router.get('/state', authenticateToken, getSpecterState);

/** GET /api/v1/specter/config — return shop config */
router.get('/config', authenticateToken, getSpecterConfig);

/** PUT /api/v1/specter/config — create/update config */
router.put('/config', authenticateToken, upsertSpecterConfig);

router.get('/ft2', httpGetSpecterFt2);

export default router;