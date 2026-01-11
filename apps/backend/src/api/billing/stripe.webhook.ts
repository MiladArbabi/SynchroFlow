// apps/backend/src/api/billing/stripe.webhook.ts
//
// Stripe Webhook → Billing Intent Adapter
//
// HARD RULES:
// - Intent only (no entitlement logic)
// - Persistent idempotency via integration_webhook_events
// - No lifecycle inference
// - Transport ledger written BEFORE domain mutation

import { Request, Response } from 'express';
import { CommercialGrantService } from 'api-src/services/commercial-grant.service';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';

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
  const event = req.body;

  // ─────────────────────────────────────────────
  // 1. Minimal payload validation
  // ─────────────────────────────────────────────
  if (!event || !event.id || !event.type) {
    logWebhookOutcome({ outcome: 'rejected_invalid_payload' });
    return res.status(400).json({ error: 'Invalid event payload' });
  }

  const eventId = event.id;
  const integration = 'stripe';
  const idempotencyKey = `${integration}:${eventId}`;

  // ─────────────────────────────────────────────
  // 2. Transport ledger insert (authoritative)
  // ─────────────────────────────────────────────
  const ledgerResult = await WebhookLedgerService.recordReceived({
  integration: 'stripe',
  externalEventId: eventId,
  eventType: event.type,
  payload: event,
  idempotencyKey,
});

if (ledgerResult.isDuplicate) {
  await WebhookLedgerService.markDuplicate(eventId);

  logWebhookOutcome({
    outcome: 'duplicate_ignored',
    eventId,
  });

  return res.status(200).json({ status: 'duplicate_ignored' });
}

  // ─────────────────────────────────────────────
  // 3. Ignore unsupported events
  // ─────────────────────────────────────────────
  if (event.type !== 'invoice.paid') {
    await WebhookLedgerService.markIgnored(
      eventId,
      'unsupported_event'
    );

    logWebhookOutcome({
      outcome: 'ignored_unsupported_event',
      eventId,
    });

    return res.status(200).json({ status: 'ignored' });
  }

  // ─────────────────────────────────────────────
  // 4. Resolve shop
  // ─────────────────────────────────────────────
  const shopIdRaw = event?.data?.object?.metadata?.shopId;
  if (!shopIdRaw) {
    await WebhookLedgerService.markFailed(eventId, 'Missing shopId');

    logWebhookOutcome({
      outcome: 'rejected_missing_shop',
      eventId,
    });

    return res.status(400).json({ error: 'Missing shopId' });
  }

  const shopId = Number(shopIdRaw);

  // ─────────────────────────────────────────────
  // 5. Extract grants
  // ─────────────────────────────────────────────
  const lines = event?.data?.object?.lines?.data ?? [];
  const modules = lines
    .map((l: any) => l?.price?.metadata?.module)
    .filter(Boolean);

  if (modules.length === 0) {
    await WebhookLedgerService.markIgnored(
      eventId,
      'no_grants',
      shopId
    );

    logWebhookOutcome({
      outcome: 'no_grants',
      eventId,
      shopId,
    });

    return res.status(200).json({ status: 'no_grants' });
  }

  // ─────────────────────────────────────────────
  // 6. Domain mutation (intent only)
  // ─────────────────────────────────────────────
  try {
    await CommercialGrantService.apply({
      shopId,
      source: 'billing',
      grants: { modules },
      metadata: {
        externalRef: eventId,
        issuedAt: new Date(event.created * 1000).toISOString(),
      },
    });

    await WebhookLedgerService.markProcessed(
      eventId,
      shopId
    );

    logWebhookOutcome({
      outcome: 'grant_applied',
      eventId,
      shopId,
    });

    return res.status(200).json({ status: 'processed' });
  } catch (err: any) {
    await WebhookLedgerService.markFailed(
      eventId,
      err?.message ?? 'Unknown error',
      shopId
    );

    logWebhookOutcome({
      outcome: 'failed',
      eventId,
      shopId,
    });

    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}