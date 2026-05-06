// apps/backend/src/api/cashflow/cashflow.routes.ts
import { Router } from 'express';
import { httpGetCashFlow } from './cashflow.controller.js';
import { httpGetCashFlowSettings, httpPatchCashFlowSettings } from './cashflow.settings.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';

const router = Router();

// Growth tier required — Cash Flow is an intelligence module (MON-06)
router.get('/', authenticateToken, requireFt2, requireTier('growth'), httpGetCashFlow);

/**
 * Cash flow overhead settings — monthly fixed costs + starting balance.
 * Used to make cash projection more accurate for the merchant.
 */
router.get('/settings', authenticateToken, requireFt2, requireTier('growth'), httpGetCashFlowSettings);
router.patch('/settings', authenticateToken, requireFt2, requireTier('growth'), httpPatchCashFlowSettings);

export default router;