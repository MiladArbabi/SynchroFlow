import { Router } from 'express';
import { getCustomerDetails, getCustomerList } from './customers.controller.js';
import { httpGetCustomersFt2 } from './customers.ft2.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';

const router = Router();

// FT2 — read-only snapshot (MUST come before :id)
router.get('/ft2', authenticateToken, requireFt2, httpGetCustomersFt2);

router.get(
  '/',
  authenticateToken,
  requireAction('customers:read'),
  getCustomerList
);

router.get(
  '/:id',
  authenticateToken,
  requireAction('customers:read'),
  getCustomerDetails
);

export default router;