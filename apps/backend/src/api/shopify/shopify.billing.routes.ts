// apps/backend/src/api/shopify/shopify.billing.routes.ts
//
// Shopify Billing routes (MON-09)
// --------------------------------
// Note: /callback is intentionally unauthenticated —
// Shopify redirects the browser here after charge approval.
// shopId is embedded in the return_url query param and validated in controller.

import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireRole } from '../../middleware/require-role.middleware.js';
import {
  createShopifyCharge,
  handleShopifyCallback,
  getShopifySubscription,
} from './shopify.billing.controller.js';

const router = Router();

// GET  /api/v1/shopify-billing/subscription
router.get('/subscription', authenticateToken, requireRole(['owner', 'admin']), getShopifySubscription);

// POST /api/v1/shopify-billing/checkout
router.post('/checkout', authenticateToken, requireRole(['owner']), createShopifyCharge);

// GET  /api/v1/shopify-billing/callback — no JWT auth (browser redirect from Shopify)
router.get('/callback', handleShopifyCallback);

export default router;