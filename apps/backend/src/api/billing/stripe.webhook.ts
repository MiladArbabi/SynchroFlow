// apps/backend/src/api/billing/stripe.webhook.ts
//
// Stripe Webhook → Billing Intent Adapter
//
// HARD RULES:
// - Intent only (no entitlement logic)
// - Idempotent by externalRef (event.id)
// - No lifecycle inference
// - No direct DB writes

import { Request, Response } from 'express';
import { CommercialGrantService } from 'api-src/services/commercial-grant.service';

// In-memory idempotency guard (process-local)
//
// NOTE:
// - This is NOT the authoritative idempotency layer
// - Persistent idempotency is enforced via commercial_grant_events
// - This guard only reduces duplicate work per process
const processedEventIds = new Set<string>();

type WebhookOutcome =
  | 'grant_applied'
  | 'duplicate_ignored'
  | 'ignored_unsupported_event'
  | 'rejected_invalid_payload'
  | 'rejected_missing_shop'
  | 'no_grants';

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

  // Minimal validation (tests rely on this shape only)
  if (!event || !event.id || !event.type) {
    logWebhookOutcome({ outcome: 'rejected_invalid_payload' });
    return res.status(400).json({ error: 'Invalid event payload' });
  }

  // Idempotency guard
  if (processedEventIds.has(event.id)) {
    logWebhookOutcome({
      outcome: 'duplicate_ignored',
      eventId: event.id,
    });
    return res.status(200).json({ status: 'duplicate_ignored' });
  }

  // Only handle paid invoice events (explicit, no inference)
  if (event.type !== 'invoice.paid') {
    logWebhookOutcome({
      outcome: 'ignored_unsupported_event',
      eventId: event.id,
    });
    return res.status(200).json({ status: 'ignored' });
  }

  const issuedAt = new Date(event.created * 1000).toISOString();

  const shopIdRaw = event?.data?.object?.metadata?.shopId;
  if (!shopIdRaw) {
    logWebhookOutcome({
      outcome: 'rejected_missing_shop',
      eventId: event.id,
    });
    return res.status(400).json({ error: 'Missing shopId' });
  }

  const shopId = Number(shopIdRaw);

  const lines = event?.data?.object?.lines?.data ?? [];
  const modules = lines
    .map((l: any) => l?.price?.metadata?.module)
    .filter(Boolean);

  if (modules.length === 0) {
    logWebhookOutcome({
      outcome: 'no_grants',
      eventId: event.id,
      shopId,
    });
    return res.status(200).json({ status: 'no_grants' });
  }

  await CommercialGrantService.apply({
    shopId,
    source: 'billing',
    grants: { modules },
    metadata: {
      externalRef: event.id,
      issuedAt,
    },
  });

  processedEventIds.add(event.id);

  logWebhookOutcome({
    outcome: 'grant_applied',
    eventId: event.id,
    shopId,
  });

  return res.status(200).json({ status: 'processed' });
}