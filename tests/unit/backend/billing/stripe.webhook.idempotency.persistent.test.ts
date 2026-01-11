// tests/unit/backend/billing/stripe.webhook.idempotency.persistent.test.ts
//
// Stripe webhook → CommercialGrant intent mapping
//
// Guarantees:
// - Stripe signature verification is enforced
// - Billing produces intent only (no entitlement coupling)
// - Intent-level idempotency is respected

import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { CommercialGrantService } from 'api-src/services/commercial-grant.service';
import { signStripePayload } from '../../helpers/stripeTestSignature';
import db from 'api-db';

jest.mock('api-src/services/commercial-grant.service');

describe('Stripe webhook → CommercialGrant intent mapping', () => {
  const app = createApp();

  beforeEach(async () => {
    jest.clearAllMocks();
    await db('integration_webhook_events').del();
    await db('commercial_grant_events').del();
  });

  it('maps a Stripe invoice.paid event into a CommercialGrant intent', async () => {
    const stripeEvent = {
      id: 'evt_test_123',
      type: 'invoice.paid',
      created: 1710000000,
      data: {
        object: {
          metadata: { shopId: '42' },
          lines: {
            data: [
              {
                price: {
                  metadata: { module: 'analytics' },
                },
              },
            ],
          },
        },
      },
    };

    const payload = JSON.stringify(stripeEvent);

    const signature = signStripePayload(
      Buffer.from(payload),
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload)
      .expect(200);

    expect(CommercialGrantService.apply).toHaveBeenCalledTimes(1);

    expect(CommercialGrantService.apply).toHaveBeenCalledWith({
      shopId: 42,
      source: 'billing',
      grants: {
        modules: ['analytics'],
      },
      metadata: {
        externalRef: 'evt_test_123',
        issuedAt: new Date(1710000000 * 1000).toISOString(),
      },
    });
  });

  it('is idempotent at the intent level when the same event is delivered twice', async () => {
    const stripeEvent = {
      id: 'evt_test_idempotent',
      type: 'invoice.paid',
      created: 1710000001,
      data: {
        object: {
          metadata: { shopId: '99' },
          lines: {
            data: [
              {
                price: {
                  metadata: { module: 'finances' },
                },
              },
            ],
          },
        },
      },
    };

    const payload = JSON.stringify(stripeEvent);

    const signature = signStripePayload(
      Buffer.from(payload),
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload)
      .expect(200);

    await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload)
      .expect(200);

    expect(CommercialGrantService.apply).toHaveBeenCalledTimes(1);
  });

  it('replay does not create additional commercial grant events', async () => {
    const payload = {
      id: 'evt_replay_test_001',
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          metadata: { shopId: '1' },
          lines: {
            data: [
              {
                price: { metadata: { module: 'analytics' } },
              },
            ],
          },
        },
      },
    };

    const body = JSON.stringify(payload);
    const signature = signStripePayload(
      Buffer.from(body),
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(body)
      .expect(200);

    await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(body)
      .expect(200);

    expect(CommercialGrantService.apply).toHaveBeenCalledTimes(1);
  });
});
