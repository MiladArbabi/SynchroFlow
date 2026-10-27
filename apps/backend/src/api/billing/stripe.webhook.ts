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
//   checkout.session.completed → handleCheckoutSetupComplete

import { Request, Response } from 'express';
import { WebhookRouter } from '../webhooks/webhookRouter.js';
import { StripeWebhookAdapter } from '../webhooks/adapters/stripe.adapter.js';
import { attributeStripeSubscription } from '../../services/billing/stripeSubscriptionAuthority.service.js';
import {
  handleSubscriptionUpsert,
  handleSubscriptionDeleted,
  handlePaymentFailed,
  handleInvoicePaid,
  handleCheckoutSetupComplete,
} from './handlers/index.js';

// Register Stripe subscription lifecycle handlers
WebhookRouter.register({
  integration: 'stripe',
  eventType: 'customer.subscription.created',
  attribute: attributeStripeSubscription,
  handle: handleSubscriptionUpsert,
});

WebhookRouter.register({
  integration: 'stripe',
  eventType: 'customer.subscription.updated',
  attribute: attributeStripeSubscription,
  handle: handleSubscriptionUpsert,
});

WebhookRouter.register({
  integration: 'stripe',
  eventType: 'customer.subscription.deleted',
  attribute: attributeStripeSubscription,
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

WebhookRouter.register({
  integration: 'stripe',
  eventType: 'checkout.session.completed',
  handle: handleCheckoutSetupComplete,
});

export async function stripeWebhookHandler(req: Request, res: Response) {
  try {
    // FI-002: attribution can reject conflicting signed invoice metadata.
    // Keep adapter errors inside the HTTP failure boundary.
    const envelope = StripeWebhookAdapter.toEnvelope(req);
    await WebhookRouter.dispatch(envelope);
    return res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    /**
     * HANDLER FAILURE → 500 (CRITICAL)
     * ---------------------------------
     * Returning 500 signals Shopify to retry delivery.
     * Never return 200 on handler failure — Shopify will
     * not retry and the event is permanently lost.
     */
    console.error('[SHOPIFY_WEBHOOK_HANDLER_FAILED]', {
      error: err?.message,
    });
    return res.status(500).json({ status: 'error' });
  }
}
