// apps/backend/src/api/shopify/shopify.routes.ts
//
// Shopify API routes
//
// HARD RULES:
// - Single webhook endpoint
// - Verification happens before routing
// - No topic-specific paths

import express, { Router } from 'express';
import { verifyShopifySignature } from './shopify.verify.middleware';
import webhookRouter from './shopify.webhook.router';

const router = Router();

/**
 * Shopify webhooks (single entrypoint)
 *
 * Shopify sends topic via X-Shopify-Topic header.
 */
router.post(
  '/webhooks',
  verifyShopifySignature,
  webhookRouter
);

export default router;