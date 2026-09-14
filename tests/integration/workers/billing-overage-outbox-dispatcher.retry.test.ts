import crypto from 'crypto';

import db, {
  systemQuery,
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import {
  dispatchBillingOverageOnce,
  type BillingOverageDeliveryDependencies,
} from 'api-src/workers/domain-event-outbox.dispatcher';

type Provider = 'stripe' | 'shopify';

async function createBillingOverageEvent(provider: Provider) {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `billing-outbox-${provider}-${unique}`
    );
    await setTenantContext(trx, id);
    return id;
  });

  const idempotencyKey = `retry_${provider}_${unique}`;

  const eventId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'billing/overage',
        event_payload: {
          billing_provider: provider,
          overage_units: 1,
          idempotency_key: idempotencyKey,
          // Deliberately omit stripe_customer_id / shop_gid.
        },
        event_time: new Date(),
        event_version: 1,
      })
      .returning('id');

    return Number(row.id);
  });

  return { shopId, eventId, idempotencyKey };
}

async function readOutbox(shopId: number, eventId: number) {
  return withTenant(shopId, (trx) =>
    trx('domain_event_outbox as o')
      .join('domain_events as e', 'e.id', 'o.domain_event_id')
      .where({
        'e.shop_id': shopId,
        'e.id': eventId,
      })
      .first(
        'o.id',
        'o.domain_event_id',
        'o.published_at',
        'o.retry_count',
        'o.last_error',
        'o.processing_at',
        'o.first_attempt_at',
        'o.last_attempt_at'
      )
  );
}

async function countEvent(shopId: number, eventId: number) {
  const [{ count }] = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({
        shop_id: shopId,
        id: eventId,
        event_type: 'billing/overage',
      })
      .count<{ count: string }[]>('* as count')
  );

  return Number(count);
}

async function publishPreexistingEligibleBillingEvents() {
  for (;;) {
    const claimed = await systemQuery(
      db.raw('SELECT * FROM public.claim_billing_overage_outbox()')
    );

    const row = claimed.rows?.[0] as
      | { outbox_id: number | string }
      | undefined;

    if (!row) return;

    await systemQuery(
      db.raw(
        'SELECT public.mark_billing_overage_outbox_published(?)',
        [row.outbox_id]
      )
    );
  }
}

describe('billing/overage durable dispatcher retry', () => {
  beforeEach(async () => {
    // Integration suites share one disposable DB. Other commercial tests may
    // leave legitimate billing/overage rows pending. Neutralize only events
    // already eligible before this test creates its own fixture.
    await publishPreexistingEligibleBillingEvents();
  });
  it('records missing Stripe customer as retryable failure without publishing or deleting the event', async () => {
    const fixture = await createBillingOverageEvent('stripe');

    const before = await readOutbox(fixture.shopId, fixture.eventId);

    expect(before).toBeDefined();
    expect(Number(before.retry_count)).toBe(0);
    expect(before.published_at).toBeNull();
    expect(before.processing_at).toBeNull();
    expect(before.first_attempt_at).toBeNull();
    expect(before.last_attempt_at).toBeNull();
    expect(before.last_error).toBeNull();

    const deliverStripe = jest.fn(async (input) => {
      expect(input.shopId).toBe(fixture.shopId);
      expect(input.stripeCustomerId).toBe('');
      expect(input.overageUnits).toBe(1);
      expect(input.idempotencyKey).toBe(fixture.idempotencyKey);

      throw new Error('STRIPE_OVERAGE_CUSTOMER_MISSING');
    });

    const deliverShopify = jest.fn(async () => undefined);

    const delivery: BillingOverageDeliveryDependencies = {
      deliverStripe,
      deliverShopify,
    };

    await dispatchBillingOverageOnce(delivery);

    expect(deliverStripe).toHaveBeenCalledTimes(1);
    expect(deliverShopify).not.toHaveBeenCalled();

    const after = await readOutbox(fixture.shopId, fixture.eventId);

    expect(Number(after.retry_count)).toBe(1);
    expect(after.published_at).toBeNull();
    expect(after.processing_at).toBeNull();
    expect(after.first_attempt_at).not.toBeNull();
    expect(after.last_attempt_at).not.toBeNull();
    expect(after.last_error).toBe('STRIPE_OVERAGE_CUSTOMER_MISSING');

    expect(await countEvent(fixture.shopId, fixture.eventId)).toBe(1);
  });

  it('records missing Shopify GID as retryable failure without publishing or deleting the event', async () => {
    const fixture = await createBillingOverageEvent('shopify');

    const deliverStripe = jest.fn(async () => undefined);

    const deliverShopify = jest.fn(async (input) => {
      expect(input.shopId).toBe(fixture.shopId);
      expect(input.shopGid).toBe('');
      expect(input.overageUnits).toBe(1);
      expect(input.idempotencyKey).toBe(fixture.idempotencyKey);

      throw new Error('SHOPIFY_OVERAGE_SHOP_GID_MISSING');
    });

    const delivery: BillingOverageDeliveryDependencies = {
      deliverStripe,
      deliverShopify,
    };

    await dispatchBillingOverageOnce(delivery);

    expect(deliverStripe).not.toHaveBeenCalled();
    expect(deliverShopify).toHaveBeenCalledTimes(1);

    const after = await readOutbox(fixture.shopId, fixture.eventId);

    expect(Number(after.retry_count)).toBe(1);
    expect(after.published_at).toBeNull();
    expect(after.processing_at).toBeNull();
    expect(after.first_attempt_at).not.toBeNull();
    expect(after.last_attempt_at).not.toBeNull();
    expect(after.last_error).toBe('SHOPIFY_OVERAGE_SHOP_GID_MISSING');

    expect(await countEvent(fixture.shopId, fixture.eventId)).toBe(1);
  });
});
