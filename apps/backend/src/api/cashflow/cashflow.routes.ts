// apps/backend/src/api/cashflow/cashflow.routes.ts
import { Router } from 'express';
import { httpGetCashFlow } from './cashflow.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';

const router = Router();

// Growth tier required — Cash Flow is an intelligence module (MON-06)
router.get('/', authenticateToken, requireFt2, requireTier('growth'), httpGetCashFlow);

export default router;