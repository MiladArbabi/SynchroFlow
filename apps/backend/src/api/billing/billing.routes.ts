// apps/backend/src/api/billing/billing.routes.ts
//
// Billing routes (MON-08)
// -----------------------
// All routes require authentication (owner/admin only via requireRole).
// Stripe webhook is registered separately in express.ts (no JWT auth).

import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireRole } from '../../middleware/require-role.middleware.js';
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
} from './billing.controller.js';

const router = Router();

// GET  /api/v1/billing/subscription — current subscription state
router.get('/subscription', authenticateToken, requireRole(['owner', 'admin']), getSubscription);

// POST /api/v1/billing/checkout — create Stripe Checkout session
router.post('/checkout', authenticateToken, requireRole(['owner']), createCheckoutSession);

// POST /api/v1/billing/portal — create Stripe Customer Portal session
router.post('/portal', authenticateToken, requireRole(['owner', 'admin']), createPortalSession);

export default router;