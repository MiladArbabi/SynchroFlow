// apps/backend/src/api/specter/specter.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';
import {
  getSpecterState,
  getSpecterConfig,
  upsertSpecterConfig,
} from './specter.controller.js';

const router = Router();

// Growth tier required — full Specter is an intelligence module (MON-06)
// /:shopId/state and /state are admin/internal — tier-gated at user level
router.get('/:shopId/state', authenticateToken, requireTier('growth'), getSpecterState);
router.get('/state', authenticateToken, requireTier('growth'), getSpecterState);
router.get('/config', authenticateToken, requireTier('growth'), getSpecterConfig);
router.put('/config', authenticateToken, requireTier('growth'), upsertSpecterConfig);

// SEC-SPECTER-FT2-UNAUTH-01: `GET /ft2` is RETIRED, not gated.
// It was mounted with no authenticateToken and resolved the tenant from the
// client-supplied `x-test-shop-id` header, so any unauthenticated caller could
// select an arbitrary shop and read its Specter FT2 exposure. The endpoint is
// removed outright — do not reintroduce it, behind a gate or under another path.

export default router;