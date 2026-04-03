// apps/backend/src/api/shopify/shopify.routes.ts
//
// Shopify API routes
//
// HARD RULES:
// - Single webhook endpoint
// - Verification happens before routing
// - No topic-specific paths

import './shopify.webhook.js'; 

import express, { Router } from 'express';
import { verifyShopifySignature } from './shopify.verify.middleware.js';
import webhookRouter from './shopify.webhook.router.js';

const router = Router();

/**
 * Shopify webhooks (single entrypoint)
 *
 * Shopify sends topic via X-Shopify-Topic header.
 */
router.use(
  '/webhooks',
  (req, res, next) => {
    const bypass =
      process.env.NODE_ENV === 'development' &&
      req.headers['x-dev-bypass-signature'] === 'true';

    if (bypass) {
      console.warn('[WEBHOOK_SIGNATURE_BYPASSED_DEV]');
      return next();
    }

    return verifyShopifySignature(req, res, next);
  },
  webhookRouter
);

export default router;