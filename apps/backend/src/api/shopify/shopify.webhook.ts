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
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { ShopifyWebhookAdapter } from 'api-src/api/webhooks/adapters/shopify.adapter';

export async function shopifyWebhookHandler(
  req: Request,
  res: Response
) {
  const envelope = ShopifyWebhookAdapter.toEnvelope(req);

  await WebhookRouter.dispatch(envelope);

  return res.status(200).json({ status: 'ok' });
}