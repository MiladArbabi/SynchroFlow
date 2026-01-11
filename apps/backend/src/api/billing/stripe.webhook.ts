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
// NOTE: Sufficient for now; persistent idempotency comes later.
const processedEventIds = new Set<string>();

export async function stripeWebhookHandler(req: Request, res: Response) {
  const event = req.body;

  // Minimal validation (tests rely on this shape only)
  if (!event || !event.id || !event.type) {
    return res.status(400).json({ error: 'Invalid event payload' });
  }

  // Idempotency guard
  if (processedEventIds.has(event.id)) {
    return res.status(200).json({ status: 'duplicate_ignored' });
  }

  // Only handle paid invoice events (explicit, no inference)
  if (event.type !== 'invoice.paid') {
    return res.status(200).json({ status: 'ignored' });
  }

  const issuedAt = new Date(event.created * 1000).toISOString();

  const shopIdRaw = event?.data?.object?.metadata?.shopId;
  if (!shopIdRaw) {
    return res.status(400).json({ error: 'Missing shopId' });
  }

  const shopId = Number(shopIdRaw);

  const lines = event?.data?.object?.lines?.data ?? [];
  const modules = lines
    .map((l: any) => l?.price?.metadata?.module)
    .filter(Boolean);

  if (modules.length === 0) {
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

  return res.status(200).json({ status: 'processed' });
}