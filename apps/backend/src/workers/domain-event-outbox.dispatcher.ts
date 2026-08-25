import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { deliverStripeOverageEvent } from '../api/billing/stripe.meter.service.js';
import { deliverShopifyOverageEvent } from '../api/billing/shopify.events.service.js';

const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 20;

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

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
