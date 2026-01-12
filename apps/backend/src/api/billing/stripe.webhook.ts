import { Request, Response } from 'express';
import { WebhookRouter } from '../webhooks/webhookRouter';
import { StripeWebhookAdapter } from '../webhooks/adapters/stripe.adapter';

type WebhookOutcome =
  | 'grant_applied'
  | 'duplicate_ignored'
  | 'ignored_unsupported_event'
  | 'rejected_invalid_payload'
  | 'rejected_missing_shop'
  | 'no_grants'
  | 'failed';

function logWebhookOutcome(params: {
  outcome: WebhookOutcome;
  eventId?: string;
  shopId?: number;
}) {
  console.log({
    domain: 'billing',
    surface: 'stripe_webhook',
    outcome: params.outcome,
    event_id: params.eventId ?? null,
    shop_id: params.shopId ?? null,
  });
}

export async function stripeWebhookHandler(req: Request, res: Response) {
  const envelope = StripeWebhookAdapter.toEnvelope(req);

  await WebhookRouter.dispatch(envelope);

  return res.status(200).json({ status: 'ok' });
}