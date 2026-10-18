import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { deliverStripeOverageEvent } from '../api/billing/stripe.meter.service.js';
import { deliverShopifyOverageEvent } from '../api/billing/shopify.events.service.js';
import { getQueueChannel } from '../queue.js';

const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 20;
const SYNC_QUEUE_NAME = 'sync_jobs';
// Bounded wait for the broker confirm; an unconfirmed publish is a retryable failure.
const SYNC_PUBLISH_CONFIRM_TIMEOUT_MS = 10_000;

let running = false;

interface BillingOverageOutboxRow {
  outbox_id: number | string;
  domain_event_id: number | string;
  shop_id: number;
  event_payload: unknown;
  event_time: Date | string;
  retry_count: number;
  first_attempt_at: Date | string;
}

interface BillingOveragePayload {
  billing_provider: 'stripe' | 'shopify';
  overage_units: number;
  idempotency_key: string;
  stripe_customer_id?: string;
  shop_gid?: string;
}

export interface BillingOverageDeliveryDependencies {
  deliverStripe: typeof deliverStripeOverageEvent;
  deliverShopify: typeof deliverShopifyOverageEvent;
}

const defaultBillingOverageDeliveryDependencies: BillingOverageDeliveryDependencies =
  {
    deliverStripe: deliverStripeOverageEvent,
    deliverShopify: deliverShopifyOverageEvent,
  };

function parseBillingPayload(raw: unknown): BillingOveragePayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('BILLING_OVERAGE_PAYLOAD_INVALID');
  }

  const payload = raw as Record<string, unknown>;

  if (
    payload.billing_provider !== 'stripe' &&
    payload.billing_provider !== 'shopify'
  ) {
    throw new Error('BILLING_OVERAGE_PROVIDER_INVALID');
  }

  const overageUnits = Number(payload.overage_units);

  if (!Number.isSafeInteger(overageUnits) || overageUnits <= 0) {
    throw new Error('BILLING_OVERAGE_UNITS_INVALID');
  }

  if (
    typeof payload.idempotency_key !== 'string' ||
    payload.idempotency_key.length === 0
  ) {
    throw new Error('BILLING_OVERAGE_IDEMPOTENCY_KEY_INVALID');
  }

  return {
    billing_provider: payload.billing_provider,
    overage_units: overageUnits,
    idempotency_key: payload.idempotency_key,
    stripe_customer_id:
      typeof payload.stripe_customer_id === 'string'
        ? payload.stripe_customer_id
        : undefined,
    shop_gid:
      typeof payload.shop_gid === 'string'
        ? payload.shop_gid
        : undefined,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown billing delivery error';
}

async function deliverBillingOverage(
  row: BillingOverageOutboxRow,
  delivery: BillingOverageDeliveryDependencies,
): Promise<void> {
  const payload = parseBillingPayload(row.event_payload);

  if (payload.billing_provider === 'stripe') {
    await delivery.deliverStripe({
      shopId: row.shop_id,
      stripeCustomerId: payload.stripe_customer_id ?? '',
      overageUnits: payload.overage_units,
      idempotencyKey: payload.idempotency_key,
      occurredAt: row.event_time,
    });
    return;
  }

  await delivery.deliverShopify({
    shopId: row.shop_id,
    shopGid: payload.shop_gid ?? '',
    overageUnits: payload.overage_units,
    idempotencyKey: payload.idempotency_key,
    occurredAt: row.event_time,
  });
}

export async function dispatchBillingOverageOnce(
  delivery: BillingOverageDeliveryDependencies =
    defaultBillingOverageDeliveryDependencies,
): Promise<void> {
  const claimed = await systemQuery(
    db.raw('SELECT * FROM public.claim_billing_overage_outbox()')
  );

  const row = claimed.rows?.[0] as BillingOverageOutboxRow | undefined;

  if (!row) return;

  try {
    await deliverBillingOverage(row, delivery);

    await systemQuery(
      db.raw(
        'SELECT public.mark_billing_overage_outbox_published(?)',
        [row.outbox_id]
      )
    );

    console.info('[domain-event-outbox] billing overage published', {
      outboxId: row.outbox_id,
      domainEventId: row.domain_event_id,
      shopId: row.shop_id,
    });
  } catch (error) {
    const message = errorMessage(error);

    await systemQuery(
      db.raw(
        'SELECT public.record_billing_overage_outbox_failure(?, ?)',
        [row.outbox_id, message]
      )
    );

    console.error('[domain-event-outbox] billing overage delivery failed', {
      outboxId: row.outbox_id,
      domainEventId: row.domain_event_id,
      shopId: row.shop_id,
      retryCount: row.retry_count,
      error: message,
    });
  }
}

export interface ShopifySyncJobMessage {
  integrationId: number;
  intentDomainEventId: number;
}

export type ShopifySyncJobPublisher = (message: ShopifySyncJobMessage) => Promise<void>;

export type ShopifySyncDispatchResult =
  | { kind: 'IDLE' }
  | {
      kind: 'PUBLISHED' | 'PUBLISH_REJECTED';
      outboxId: number;
      intentDomainEventId: number;
      integrationId: number;
      shopId: number;
      recovery: boolean;
    };

/**
 * Persistent sync_jobs message on the confirm channel: resolves only after the
 * broker confirms it; rejects on nack, channel loss or the bounded timeout.
 */
export async function publishShopifySyncJob(message: ShopifySyncJobMessage): Promise<void> {
  await getQueueChannel(SYNC_QUEUE_NAME).sendToQueue(
    SYNC_QUEUE_NAME,
    Buffer.from(JSON.stringify(message)),
    { persistent: true, timeout: SYNC_PUBLISH_CONFIRM_TIMEOUT_MS },
  );
}

/**
 * GH-1068 T3-B durable sync dispatch: claim one eligible intent, publish it
 * with broker confirmation, then mark it published. A failed or unconfirmed
 * publish is recorded for backoff retry; a crash leaves the claim lease to
 * expire. Never launches Shopify sync itself.
 */
export async function dispatchShopifySyncIntentOnce(
  publish: ShopifySyncJobPublisher = publishShopifySyncJob,
): Promise<ShopifySyncDispatchResult> {
  const claimed = await systemQuery(
    db.raw('SELECT * FROM public.claim_shopify_sync_dispatch_outbox()')
  );
  const row = claimed.rows?.[0];
  if (!row) return { kind: 'IDLE' };

  const claim = {
    outboxId: Number(row.outbox_id),
    intentDomainEventId: Number(row.domain_event_id),
    integrationId: Number(row.integration_id),
    shopId: Number(row.shop_id),
    recovery: row.recovery === true,
  };

  try {
    await publish({
      integrationId: claim.integrationId,
      intentDomainEventId: claim.intentDomainEventId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync dispatch error';
    await systemQuery(
      db.raw(
        'SELECT public.record_shopify_sync_dispatch_outbox_failure(?, ?) AS ok',
        [claim.outboxId, message]
      )
    );
    console.error('[domain-event-outbox] sync dispatch publish rejected', {
      ...claim, retryCount: row.retry_count, error: message,
    });
    return { kind: 'PUBLISH_REJECTED', ...claim };
  }

  const marked = await systemQuery(
    db.raw(
      'SELECT public.mark_shopify_sync_dispatch_outbox_published(?) AS ok',
      [claim.outboxId]
    )
  );
  if (marked.rows?.[0]?.ok !== true) {
    // Lease expired and was reclaimed; the duplicate delivery is single-flight safe.
    console.warn('[domain-event-outbox] sync dispatch confirmation not recorded', claim);
  }
  console.info('[domain-event-outbox] sync dispatch published', claim);
  return { kind: 'PUBLISHED', ...claim };
}

export async function startDomainEventOutboxDispatcher() {
  if (running) return;
  running = true;

  console.log('[domain-event-outbox] Dispatcher started');

  while (running) {
    try {
      // Existing non-billing events retain their current publish-marker path.
      await systemQuery(
        db.raw(
          'SELECT * FROM public.dispatch_domain_event_outbox_batch(?)',
          [BATCH_SIZE]
        )
      );

      // billing/overage is durable: claim → provider → success/failure state.
      await dispatchBillingOverageOnce();
    } catch (error) {
      console.error('[domain-event-outbox] error:', error);
    }

    try {
      // Shopify sync intents are durable: claim → confirmed publish → marked.
      await dispatchShopifySyncIntentOnce();
    } catch (error) {
      console.error('[domain-event-outbox] sync dispatch error:', error);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
