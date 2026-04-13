// apps/backend/src/api/billing/stripe.webhook.ts
//
// Stripe Webhook Entry Point
// --------------------------
// Adapts raw Stripe HTTP request → WebhookEnvelope → WebhookRouter.
//
// Subscription lifecycle events registered here (MON-02):
//   customer.subscription.created  → handleSubscriptionUpsert
//   customer.subscription.updated  → handleSubscriptionUpsert
//   customer.subscription.deleted  → handleSubscriptionDeleted
//   invoice.payment_failed         → handlePaymentFailed
//   invoice.payment_succeeded      → handleInvoicePaid

import { Request, Response } from 'express';
import { WebhookRouter } from '../webhooks/webhookRouter.js';
import { StripeWebhookAdapter } from '../webhooks/adapters/stripe.adapter.js';
import {
  handleSubscriptionUpsert,
  handleSubscriptionDeleted,
  handlePaymentFailed,
  handleInvoicePaid,
} from './handlers/index.js';

// Register Stripe subscription lifecycle handlers
WebhookRouter.register({
  integration: 'stripe',
  eventType: 'customer.subscription.created',
  handle: handleSubscriptionUpsert,
});

WebhookRouter.register({
  integration: 'stripe',
  eventType: 'customer.subscription.updated',
  handle: handleSubscriptionUpsert,
});

WebhookRouter.register({
  integration: 'stripe',
  eventType: 'customer.subscription.deleted',
  handle: handleSubscriptionDeleted,
});

WebhookRouter.register({
  integration: 'stripe',
  eventType: 'invoice.payment_failed',
  handle: handlePaymentFailed,
});

WebhookRouter.register({
  integration: 'stripe',
  eventType: 'invoice.payment_succeeded',
  handle: handleInvoicePaid,
});

export async function stripeWebhookHandler(req: Request, res: Response) {
  const envelope = StripeWebhookAdapter.toEnvelope(req);
  await WebhookRouter.dispatch(envelope);
  return res.status(200).json({ status: 'ok' });
}