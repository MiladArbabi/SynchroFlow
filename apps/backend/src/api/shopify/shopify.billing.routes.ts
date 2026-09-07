// apps/backend/src/api/shopify/shopify.billing.routes.ts
//
// Shopify Billing routes (MON-09)
// --------------------------------
// Managed Pricing owns plan selection.
// The retired direct-charge callback must not be exposed by this router.

import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import {
  getShopifySubscription,
} from './shopify.billing.controller.js';

const router = Router();

// GET  /api/v1/shopify-billing/subscription
router.get('/subscription', authenticateToken, requireAction('shopify-billing:read'), getShopifySubscription);

/**
 * RETIRED (Shopify App Pricing migration, June 2026)
 * ----------------------------------------------------
 * createShopifyCharge / changeShopifyPlan called appSubscriptionCreate
 * directly, which Shopify rejects for apps on Shopify App Pricing
 * ("Managed Pricing Apps cannot use the Billing API to create charges").
 * Plan selection now happens entirely on Shopify's hosted pricing page;
 * entitlements will sync via the Active Subscription API (separate workstream).
 * Routes intentionally removed rather than left live and silently broken.
 */
export default router;