// apps/backend/src/api/billing/billing.routes.ts
//
// Billing routes (MON-08)
// -----------------------
// All routes require authentication. Access controlled via requireAction.
// Stripe webhook is registered separately in express.ts (no JWT auth).

import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import {
  createCheckoutSession,
  createSetupSession,
  createPortalSession,
  getSubscription,
  getUsage,
  addSeats,
} from './billing.controller.js';

const router = Router();

// GET  /api/v1/billing/subscription — current subscription state
router.get('/subscription', authenticateToken, requireAction('billing:read'), getSubscription);

router.get('/usage', authenticateToken, requireAction('billing:read'), getUsage);

// POST /api/v1/billing/checkout — create Stripe Checkout session
router.post('/checkout', authenticateToken, requireAction('billing:write'), createCheckoutSession);

// POST /api/v1/billing/portal — create Stripe Customer Portal session
router.post('/portal', authenticateToken, requireAction('billing:read'), createPortalSession);

// POST /api/v1/billing/setup-payment-method — save a card, no subscription (SEG-022-B)
router.post('/setup-payment-method', authenticateToken, requireAction('billing:write'), createSetupSession);

// POST /api/v1/billing/add-seats — add extra team seats to existing subscription (AUD-C16)
router.post('/add-seats', authenticateToken, requireAction('billing:write'), addSeats);

export default router;