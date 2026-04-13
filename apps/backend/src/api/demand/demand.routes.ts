// apps/backend/src/api/demand/demand.routes.ts
import { Router } from 'express';
import { httpGetDemand } from './demand.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';

const router = Router();

// Growth tier required — Demand is an intelligence module (MON-06)
router.get('/', authenticateToken, requireFt2, requireTier('growth'), httpGetDemand);

export default router;