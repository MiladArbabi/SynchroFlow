// Replace with that
// apps/backend/src/api/shopify/shopify.routes.ts
import express, { Router } from 'express';
import { shopifyAppUninstalledWebhook } from './shopify.webhook';
import { verifyShopifySignature } from './shopify.verify.middleware';

const router = Router();

/**
 * Shopify "app/uninstalled" webhook.
 *
 * Transport-first:
 * - Raw body REQUIRED for HMAC verification
 * - Ledger written before domain mutation
 * - Idempotent via integration_webhook_events
 */

router.post(
  '/webhooks/app-uninstalled',
  verifyShopifySignature,
  shopifyAppUninstalledWebhook
);

export default router;