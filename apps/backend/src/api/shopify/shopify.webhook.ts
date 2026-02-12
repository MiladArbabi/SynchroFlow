// Replace with that
// apps/backend/src/api/shopify/shopify.webhook.ts
//
// Shopify Webhook → Transport Intent Adapter
//
// HARD RULES:
// - Transport ledger is authoritative
// - Idempotency enforced via integration_webhook_events
// - Domain mutation happens ONLY after ledger write
// - No verification, no lifecycle logic
// - Ledger schema is NOT extended

import { Request, Response } from 'express';
// apps/backend/src/api/shopify/shopify.webhook.ts

import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { ShopifyWebhookAdapter } from 'api-src/api/webhooks/adapters/shopify.adapter';

import {
  onShopifyAppUninstalled,
  handleOrderFulfillment,
  handleRefundCreated,
  handleOrderCreated,
  handleOrderPaid
} from './handlers';

/**
 * Shopify Webhook Route Registration
 * ---------------------------------
 * This file is the ONLY place where Shopify webhook
 * eventTypes are bound to handlers.
 *
 * Rules:
 * - No wildcards
 * - No branching
 * - One event → one handler
 * - Unsupported events are ignored by design
 */

console.log('[SHOPIFY WEBHOOK REGISTRATION FILE LOADED]');

// App lifecycle
WebhookRouter.register({
  integration: 'shopify',
  eventType: 'app/uninstalled',
  handle: onShopifyAppUninstalled,
});

// Order Creations
WebhookRouter.register({
  integration: 'shopify',
  eventType: 'orders/create',
  handle: handleOrderCreated,
});

// Legacy / fallback (defensive, not semantic)
WebhookRouter.register({
  integration: 'shopify',
  eventType: 'orders/fulfilled',
  handle: handleOrderFulfillment,
});

// Order Paid
WebhookRouter.register({
  integration: 'shopify',
  eventType: 'orders/paid',
  handle: handleOrderPaid,
});

// Fulfillment lifecycle (execution truth)
WebhookRouter.register({
  integration: 'shopify',
  eventType: 'fulfillments/create',
  handle: handleOrderFulfillment,
});

WebhookRouter.register({
  integration: 'shopify',
  eventType: 'fulfillments/update',
  handle: handleOrderFulfillment,
});

// Refunds (authoritative revenue regression)
WebhookRouter.register({
  integration: 'shopify',
  eventType: 'refunds/create',
  handle: handleRefundCreated,
});

export async function shopifyWebhookHandler(
  req: Request,
  res: Response
) {
  const envelope = ShopifyWebhookAdapter.toEnvelope(req);

  await WebhookRouter.dispatch(envelope);

  return res.status(200).json({ status: 'ok' });
}