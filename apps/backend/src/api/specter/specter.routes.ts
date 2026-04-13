// apps/backend/src/api/specter/specter.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';
import {
  getSpecterState,
  getSpecterConfig,
  upsertSpecterConfig,
} from './specter.controller.js';
import { httpGetSpecterFt2 } from './specter.ft2.controller.js';

const router = Router();

// Growth tier required — full Specter is an intelligence module (MON-06)
// /:shopId/state and /state are admin/internal — tier-gated at user level
router.get('/:shopId/state', authenticateToken, requireTier('growth'), getSpecterState);
router.get('/state', authenticateToken, requireTier('growth'), getSpecterState);
router.get('/config', authenticateToken, requireTier('growth'), getSpecterConfig);
router.put('/config', authenticateToken, requireTier('growth'), upsertSpecterConfig);

// ft2 internal probe — no tier gate (system use only)
router.get('/ft2', httpGetSpecterFt2);

export default router;