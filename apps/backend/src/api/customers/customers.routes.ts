import { Router } from 'express';
import { getCustomerDetails, getCustomerList } from './customers.controller.js';
import { httpGetCustomersFt2 } from './customers.ft2.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';
const router = Router();
// FT2 — read-only snapshot (MUST come before :id)
router.get('/ft2', authenticateToken, requireFt2, httpGetCustomersFt2);
// ISS-G2: customers is a Growth-exclusive module (GROWTH_MODULES only,
// absent from CORE_MODULES) but these base routes previously had no
// tier gate — only RBAC via requireAction, which checks role, not
// plan. Any authenticated Starter/Core shop could call this directly
// and receive real customer data, bypassing the paywall entirely even
// though the frontend PlanGate correctly hid the UI.
router.get(
  '/',
  authenticateToken,
  requireTier('growth'),
  requireAction('customers:read'),
  getCustomerList
);
router.get(
  '/:id',
  authenticateToken,
  requireTier('growth'),
  requireAction('customers:read'),
  getCustomerDetails
);

export default router;