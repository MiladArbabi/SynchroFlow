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
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';
import { ShopifyAppService } from 'api-src/services/shopify-app.service';

type WebhookOutcome =
  | 'processed'
  | 'duplicate'
  | 'failed';

function logOutcome(params: {
  outcome: WebhookOutcome;
  eventId?: string;
  shopDomain?: string;
}) {
  console.log({
    domain: 'shopify',
    surface: 'app_uninstalled',
    outcome: params.outcome,
    event_id: params.eventId ?? null,
    shop_domain: params.shopDomain ?? null,
  });
}

export async function shopifyAppUninstalledWebhook(
  req: Request,
  res: Response
) {
  const eventId =
    (req.headers['x-shopify-webhook-id'] as string | undefined) ??
    'missing_event_id';

  const shopDomain =
    req.headers['x-shopify-shop-domain'] as string | undefined;

  // ─────────────────────────────────────────────
  // 1. Transport ledger insert (authoritative)
  // ─────────────────────────────────────────────
  const ledgerResult = await WebhookLedgerService.recordReceived({
    integration: 'shopify',
    externalEventId: eventId,
    eventType: 'app/uninstalled',
    payload: req.body,
    idempotencyKey: `shopify:${eventId}`,
  });

  if (ledgerResult.isDuplicate) {
    await WebhookLedgerService.markDuplicate(eventId);

    logOutcome({
      outcome: 'duplicate',
      eventId,
    });

    return res.status(200).json({ status: 'duplicate' });
  }

  // ─────────────────────────────────────────────
  // 2. Header validation
  // ─────────────────────────────────────────────
  if (!shopDomain) {
    await WebhookLedgerService.markFailed(
      eventId,
      'missing_shop_domain'
    );

    logOutcome({
      outcome: 'failed',
      eventId,
    });

    return res.status(200).json({ status: 'failed' });
  }

  // ─────────────────────────────────────────────
  // 3. Domain mutation
  // ─────────────────────────────────────────────
  try {
    await ShopifyAppService.markAppUninstalled(shopDomain);

    await WebhookLedgerService.markProcessed(eventId);

    logOutcome({
      outcome: 'processed',
      eventId,
      shopDomain,
    });

    return res.status(200).json({ status: 'processed' });
  } catch (err: any) {
    await WebhookLedgerService.markFailed(
      eventId,
      err?.message ?? 'domain_error'
    );

    logOutcome({
      outcome: 'failed',
      eventId,
      shopDomain,
    });

    return res.status(200).json({ status: 'failed' });
  }
}